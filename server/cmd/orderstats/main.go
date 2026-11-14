package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"time"

	"course.local/orderstats/internal/api"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := run(ctx); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) error {
	addr := envOr("ORDERS_ADDR", "127.0.0.1:8080")
	origin, err := api.NormalizeOrigin(envOr("ORDERS_ORIGIN", "http://127.0.0.1:8080"))
	if err != nil {
		return err
	}
	sqlPath := envOr("ORDERS_STATISTICS_SQL", "db/queries/statistics.sql")
	sql, err := os.ReadFile(sqlPath)
	if err != nil {
		return fmt.Errorf("read statistics SQL: %w", err)
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" && os.Getenv("PGDATABASE") == "" {
		return errors.New("set DATABASE_URL or PGDATABASE and PostgreSQL connection variables")
	}
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return errors.New("invalid PostgreSQL connection configuration")
	}
	poolConfig.MaxConns = 10
	poolConfig.ConnConfig.RuntimeParams["statement_timeout"] = "5000"
	connectCtx, cancelConnect := context.WithTimeout(ctx, 5*time.Second)
	db, err := pgxpool.NewWithConfig(connectCtx, poolConfig)
	if err != nil {
		cancelConnect()
		return errors.New("could not initialize PostgreSQL connection pool")
	}
	defer db.Close()
	err = db.Ping(connectCtx)
	cancelConnect()
	if err != nil {
		return errors.New("PostgreSQL unreachable or credentials refused")
	}

	service, err := api.New(db, string(sql), origin)
	if err != nil {
		return fmt.Errorf("initialize API: %w", err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", service.Handler())
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(r.Context()); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, "ok")
	})
	if dir := os.Getenv("ORDERS_STATIC_DIR"); dir != "" {
		client, err := spaHandler(dir)
		if err != nil {
			return fmt.Errorf("read React build: %w", err)
		}
		mux.Handle("/", client)
	}

	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "same-origin")
			mux.ServeHTTP(w, r)
		}),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 15 * time.Second, IdleTimeout: time.Minute,
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	defer listener.Close()
	log.Printf("Order statistics listening on http://%s", listener.Addr())
	serverErr := make(chan error, 1)
	go func() { serverErr <- server.Serve(listener) }()
	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func spaHandler(dir string) (http.Handler, error) {
	files := os.DirFS(dir)
	if info, err := fs.Stat(files, "index.html"); err != nil {
		return nil, err
	} else if info.IsDir() {
		return nil, errors.New("index.html is not a file")
	}
	static := http.FileServerFS(files)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" {
			if info, err := fs.Stat(files, name); err == nil && !info.IsDir() {
				static.ServeHTTP(w, r)
				return
			}
			if strings.HasPrefix(name, "assets/") || path.Ext(name) != "" {
				http.NotFound(w, r)
				return
			}
		}

		w.Header().Set("Cache-Control", "no-cache")
		index := r.Clone(r.Context())
		index.URL.Path, index.URL.RawPath = "/", ""
		static.ServeHTTP(w, index)
	}), nil
}
