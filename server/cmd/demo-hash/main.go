package main

import (
	"bytes"
	"fmt"
	"io"
	"os"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	input, err := io.ReadAll(io.LimitReader(os.Stdin, 75))
	if err != nil {
		fmt.Fprintln(os.Stderr, "Could not read the demo password.")
		os.Exit(1)
	}
	password := bytes.TrimSuffix(input, []byte("\n"))
	password = bytes.TrimSuffix(password, []byte("\r"))
	if len(password) < 12 || len(password) > 72 || bytes.ContainsAny(password, "\r\n") {
		fmt.Fprintln(os.Stderr, "Use a single-line demo password between 12 and 72 bytes.")
		os.Exit(1)
	}
	hash, err := bcrypt.GenerateFromPassword(password, 12)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Could not hash the demo password.")
		os.Exit(1)
	}
	fmt.Println(string(hash))
}
