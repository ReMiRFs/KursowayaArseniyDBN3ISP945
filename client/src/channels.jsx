import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { ErrorMessage, RequestState, useRequest } from './shared.jsx';

export function Channels() {
  const channels = useRequest(signal => api('/sales-channels', { signal }), []);
  const [editor, setEditor] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const nameInput = useRef(null);
  const removeDialog = useRef(null);
  const addButton = useRef(null);

  useEffect(() => {
    if (editor !== null) nameInput.current?.focus();
  }, [editor?.id]);
  useEffect(() => {
    const dialog = removeDialog.current;
    if (removing && dialog && !dialog.open) dialog.showModal();
    if (!removing && dialog?.open) dialog.close();
  }, [removing]);

  function openEditor(channel) {
    setNotice('');
    setError(null);
    setEditor(channel || { id: null, name: '' });
    if (editor?.id === channel?.id) nameInput.current?.focus();
  }

  function closeEditor() {
    setEditor(null);
    setError(null);
    addButton.current?.focus();
  }

  async function save(event) {
    event.preventDefault();
    if (pending) return;
    const name = editor.name.trim();
    if (!name || [...name].length > 50) {
      setError(new Error('Введите название от 1 до 50 символов.'));
      return;
    }
    setError(null);
    setPending(true);
    try {
      await api(editor.id ? '/sales-channels/' + editor.id : '/sales-channels',
        { method: editor.id ? 'PATCH' : 'POST', body: { name } });
      setNotice(editor.id ? 'Канал изменён.' : 'Канал добавлен.');
      setEditor(null);
      addButton.current?.focus();
      channels.retry();
    } catch (problem) {
      setError(problem);
    } finally {
      setPending(false);
    }
  }

  function confirm(channel) {
    setEditor(null);
    setNotice('');
    setError(null);
    setRemoving(channel);
  }

  async function remove() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await api('/sales-channels/' + removing.id, { method: 'DELETE' });
      setNotice('Канал удалён.');
      setRemoving(null);
      addButton.current?.focus();
      channels.retry();
    } catch (problem) {
      setRemoving(null);
      setError(problem);
    } finally {
      setPending(false);
    }
  }

  return <div className="stack">
    <div className="heading heading-actions">
      <div><h1>Каналы продаж</h1><p className="muted">Источники поступления заказов</p></div>
      <button ref={addButton} className="button button-primary" type="button" disabled={pending} onClick={() => openEditor(null)}>Добавить канал</button>
    </div>
    {editor && <form className="panel channel-form" onSubmit={save} noValidate>
      <h2>{editor.id ? 'Изменить канал' : 'Новый канал'}</h2>
      <label>Название канала<input ref={nameInput} name="name" data-testid="channel-name" value={editor.name}
        onChange={event => setEditor({ ...editor, name: event.target.value })} required /></label>
      <div className="actions">
        <button className="button button-primary" type="submit" disabled={pending}>Сохранить</button>
        <button className="button" type="button" disabled={pending} onClick={closeEditor}>Отмена</button>
      </div>
    </form>}
    <ErrorMessage error={error} />
    {notice && <p className="message" role="status">{notice}</p>}
    <RequestState request={channels} loadingText="Загружаем каналы продаж…">{data =>
      data.items.length === 0 ? <p className="message" role="status">Каналов пока нет.</p> :
        <div className="panel list-panel">
          <table className="data-table channel-table" aria-label="Список каналов продаж">
            <thead><tr><th scope="col">Название</th><th scope="col">Действия</th></tr></thead>
            <tbody>{data.items.map(channel => <tr key={channel.id}><th scope="row">{channel.name}</th><td>
              <div className="actions"><button type="button" className="button" disabled={pending}
                aria-label={'Изменить канал «' + channel.name + '»'} onClick={() => openEditor(channel)}>Изменить</button>
              <button type="button" className="button button-danger-text" disabled={pending}
                aria-label={'Удалить канал «' + channel.name + '»'} onClick={() => confirm(channel)}>Удалить</button></div>
            </td></tr>)}</tbody>
          </table>
        </div>
    }</RequestState>
    <dialog ref={removeDialog} aria-labelledby="remove-title" onCancel={event => {
      event.preventDefault();
      if (!pending) setRemoving(null);
    }}>
      <h2 id="remove-title">Удалить канал?</h2>
      <p>Канал «{removing?.name}» будет удалён из справочника.</p>
      <div className="actions">
        <button className="button" type="button" onClick={() => setRemoving(null)} disabled={pending}>Отмена</button>
        <button className="button button-danger" type="button" onClick={remove} disabled={pending}>Удалить</button>
      </div>
    </dialog>
  </div>;
}
