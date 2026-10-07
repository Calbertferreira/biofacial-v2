'use client';

import { useEffect, useState } from 'react';

type User = { id: string; name: string; email: string; role: 'adm' | 'staff' | 'gestor'; clientIds: string[]; mustChangePassword?: boolean; active?: boolean };
type Client = { id: string; name: string; externalId?: string; active: boolean };
type Event = { id: string; name: string; clientId: string | null; status: string; startsAt: string };

async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method, headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function PasswordField({ label, name, autoComplete, minLength, maxLength, placeholder }: {
  label: string;
  name: string;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);

  return <div className="adminPasswordGroup">
    <label htmlFor={name}>{label}</label>
    <div className="adminPasswordField">
      <input id={name} name={name} type={visible ? 'text' : 'password'} required
        autoComplete={autoComplete} minLength={minLength} maxLength={maxLength} placeholder={placeholder} />
      <button type="button" className="adminPasswordToggle"
        onClick={() => setVisible(current => !current)}
        aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`}
        aria-pressed={visible} title={`${visible ? 'Ocultar' : 'Mostrar'} senha`}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {!visible && <path d="M3 21 21 3" />}
        </svg>
      </button>
    </div>
  </div>;
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [newRole, setNewRole] = useState<'adm' | 'staff' | 'gestor'>('gestor');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadLists() {
    const [c, u, e] = await Promise.all([
      api('/api/manage/clients'), api('/api/manage/users'), api('/api/manage/events'),
    ]);
    setClients(c.items); setUsers(u.items); setEvents(e.items);
  }
  useEffect(() => {
    void (async () => {
      try {
        const current = await api('/api/session/me');
        setUser(current);
        if (!current.mustChangePassword) await loadLists();
      } catch { setUser(null); }
      finally { setLoading(false); }
    })();
  }, []);

  async function run(task: () => Promise<void>) {
    setError(''); setMessage('');
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro inesperado'); }
  }

  if (loading) return <main className="adminLoading"><span className="adminLoadingIcon">A</span><p>Preparando seu painel...</p></main>;
  if (!user) return <main className="adminAuth">
    <div className="adminAuthVisual"><div className="adminAuthVisualInner"><img src="/brand/allticket-logo.png" alt="AllTicket Controle de Público" /><div><span className="adminEyebrow">CONTROLE DE PÚBLICO INTELIGENTE</span><h1>O seu evento começa com uma boa experiência.</h1><p>Convites, pessoas e acessos conectados em um só lugar.</p></div><small>ALLTICKET · MANAGER</small></div></div>
    <div className="adminAuthRight"><div className="adminAuthCard"><span className="adminEyebrow">ÁREA RESTRITA</span><h2>Bem-vindo de volta.</h2><p>Acesse o painel para acompanhar e organizar seus eventos.</p>
    <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => {
      const result = await api('/api/session/login', 'POST', { email: form.get('email'), password: form.get('password') });
      setUser(result.user);
      if (!result.user.mustChangePassword) await loadLists();
    }); }}>
      <label>E-mail<input name="email" type="email" required autoComplete="username" placeholder="seu@email.com" /></label>
      <PasswordField label="Senha" name="password" autoComplete="current-password" placeholder="Digite sua senha" />
      <button className="adminPrimary">Entrar no painel <span>→</span></button>
    </form>{message && <p role="status" className="adminSuccess">{message}</p>}{error && <p role="alert" className="adminError">{error}</p>}<small>Acesso exclusivo para usuários autorizados.</small></div><span className="adminCopyright">© {new Date().getFullYear()} AllTicket · Controle de Público</span></div>
  </main>;

  if (user.mustChangePassword) return <main className="adminAuth">
    <div className="adminAuthVisual"><div className="adminAuthVisualInner"><img src="/brand/allticket-logo.png" alt="AllTicket Controle de Público" /><div><span className="adminEyebrow">PRIMEIRO ACESSO</span><h1>O seu evento começa com uma boa experiência.</h1><p>Convites, pessoas e acessos conectados em um só lugar.</p></div><small>ALLTICKET · MANAGER</small></div></div>
    <div className="adminAuthRight"><div className="adminAuthCard"><span className="adminEyebrow">SEGURANÇA DA CONTA</span><h2>Proteja sua conta.</h2><p>Olá, {user.name}. Defina uma senha pessoal para continuar.</p>
    <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => {
      const currentPassword = String(form.get('currentPassword') ?? '');
      const newPassword = String(form.get('newPassword') ?? '');
      if (newPassword.length < 12) throw new Error('A nova senha precisa ter pelo menos 12 caracteres.');
      if (newPassword.length > 128) throw new Error('A nova senha pode ter no máximo 128 caracteres.');
      if (currentPassword === newPassword) throw new Error('A nova senha deve ser diferente da senha temporária.');
      try {
        await api('/api/session/change-password', 'POST', { currentPassword, newPassword });
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        const descriptions: Record<string, string> = {
          current_password_required: 'Informe a senha temporária.',
          new_password_required: 'Informe a nova senha.',
          new_password_too_short: 'A nova senha precisa ter pelo menos 12 caracteres.',
          new_password_too_long: 'A nova senha pode ter no máximo 128 caracteres.',
          new_password_must_differ: 'A nova senha deve ser diferente da senha temporária.',
          invalid_credentials: 'A senha temporária está incorreta.',
        };
        throw new Error(descriptions[code] ?? 'Não foi possível alterar a senha. Tente novamente.');
      }
      setUser(null); setMessage('Senha alterada. Entre novamente.');
    }); }}>
      <PasswordField label="Senha temporária" name="currentPassword" autoComplete="current-password" />
      <PasswordField label="Nova senha" name="newPassword" minLength={12} maxLength={128} autoComplete="new-password" placeholder="De 12 a 128 caracteres" />
      <p>Use de 12 a 128 caracteres. A nova senha pode conter letras, números e símbolos e deve ser diferente da senha temporária.</p>
      <button className="adminPrimary">Alterar senha <span>→</span></button>
    </form>{error && <p role="alert" className="adminError">{error}</p>}</div><span className="adminCopyright">© {new Date().getFullYear()} AllTicket · Controle de Público</span></div>
  </main>;

  const canCreate = user.role !== 'staff';
  return <main className="adminDashboard">
    <aside className="adminSidebar"><img src="/brand/allticket-logo.png" alt="AllTicket Controle de Público" /><span className="adminSidebarProduct">MANAGER / BIOFACIAL</span><span className="adminSidebarLabel">ESPAÇO DE TRABALHO</span><nav aria-label="Navegação principal"><a href="#inicio">◫ &nbsp; Visão geral</a><a href="#eventos">▣ &nbsp; Eventos</a><a href="#clientes">▦ &nbsp; Clientes</a><a href="#usuarios">♙ &nbsp; Usuários</a></nav><div className="adminSidebarTip"><strong>✦ Seu evento em foco.</strong><p>Gerencie a operação com clareza, do convite à entrada.</p></div><div className="adminSidebarUser"><span>{user.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.role === 'adm' ? 'Administrador' : user.role === 'staff' ? 'Equipe' : 'Gestor'}</small></div></div></aside>
    <div className="adminMain"><header className="adminTopbar"><span>Manager <b>/</b> Visão geral</span><div><span className="adminRole">{user.role === 'adm' ? 'Administrador' : user.role === 'staff' ? 'Equipe' : 'Gestor'}</span><button onClick={() => void run(loadLists)}>↻ Atualizar</button><button onClick={() => void run(async () => { await api('/api/session/logout', 'POST'); setUser(null); })}>Sair ↗</button></div></header>
    <div className="adminContent" id="inicio"><div className="adminIntro"><div><span className="adminEyebrow">PAINEL DE CONTROLE</span><h1>Olá, {user.name.split(' ')[0]} <em>✳</em></h1><p>Acompanhe o que acontece na sua operação.</p></div><time>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date())}</time></div>
    <div className="adminHero"><div><span>ALLTICKET MANAGER</span><h2>Tudo pronto para o seu próximo evento?</h2><p>Organize clientes, equipe e eventos no mesmo lugar. Cada detalhe conta para uma experiência melhor.</p><a href="#eventos">Ver eventos →</a></div></div>
    <div className="adminStats"><a href="#eventos"><small>Eventos</small><strong>{events.length}</strong><span>Ver todos ↗</span></a><a href="#clientes"><small>Clientes ativos</small><strong>{clients.filter(item => item.active).length}</strong><span>Ver clientes ↗</span></a><a href="#usuarios"><small>Usuários ativos</small><strong>{users.filter(item => item.active).length}</strong><span>Ver equipe ↗</span></a></div>
    {error && <p role="alert" className="adminError">{error}</p>}
    {message && <p role="status" className="adminSuccess">{message}</p>}

    <section id="clientes"><div className="adminSectionTitle"><span className="adminEyebrow">ORGANIZAÇÃO</span><h2>Clientes</h2><p>Empresas e organizações vinculadas aos eventos.</p></div>
      {user.role === 'adm' && <form onSubmit={event => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => {
        await api('/api/manage/clients', 'POST', { name: form.get('name'), externalId: form.get('externalId') || undefined });
        await loadLists(); setMessage('Cliente cadastrado.'); formElement.reset();
      }); }}>
        <label>Nome <input name="name" required minLength={2} /></label>{' '}
        <label>ID externo <input name="externalId" /></label>{' '}
        <button>Cadastrar cliente</button>
      </form>}
      <ul>{clients.map(client => <li key={client.id}>{client.name} · {client.id} {!client.active && '(inativo)'}</li>)}</ul>
    </section>

    <section id="usuarios"><div className="adminSectionTitle"><span className="adminEyebrow">ACESSO E PERMISSÕES</span><h2>Usuários da aplicação</h2><p>Gerencie quem pode acessar o painel e seus clientes.</p></div>
      {canCreate && <form onSubmit={event => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => {
        const selected = form.getAll('clientIds').map(String);
        await api('/api/manage/users', 'POST', {
          name: form.get('name'), email: form.get('email'), role: newRole,
          clientIds: newRole === 'gestor' ? selected : [], temporaryPassword: form.get('temporaryPassword'),
        });
        await loadLists(); setMessage('Usuário cadastrado. Entregue a senha temporária por um canal seguro.');
        formElement.reset();
      }); }}>
        <label>Nome <input name="name" required minLength={2} /></label>{' '}
        <label>Email <input name="email" type="email" required /></label>{' '}
        <label>Perfil <select value={newRole} onChange={event => setNewRole(event.target.value as typeof newRole)}>
          {user.role === 'adm' && <><option value="adm">adm</option><option value="staff">staff</option></>}
          <option value="gestor">gestor</option>
        </select></label>{' '}
        <PasswordField label="Senha temporária" name="temporaryPassword" minLength={12} autoComplete="new-password" />
        {newRole === 'gestor' && <fieldset><legend>Clientes permitidos</legend>{clients.filter(c => c.active).map(client =>
          <label key={client.id}><input type="checkbox" name="clientIds" value={client.id} /> {client.name} </label>)}</fieldset>}
        <button>Cadastrar usuário</button>
      </form>}
      <ul>{users.map(item => <li key={item.id}>{item.name} · {item.email} · {item.role}{item.clientIds?.length ? ` · ${item.clientIds.map(id => clients.find(c => c.id === id)?.name ?? id).join(', ')}` : ''} {!item.active && '(inativo)'}</li>)}</ul>
    </section>

    <section id="eventos"><div className="adminSectionTitle"><span className="adminEyebrow">PROGRAMAÇÃO</span><h2>Eventos</h2><p>Organize os próximos encontros e acompanhe sua operação.</p></div>
      {canCreate && <form onSubmit={event => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => {
        await api('/api/manage/events', 'POST', {
          clientId: form.get('clientId'), name: form.get('name'), venue: form.get('venue'),
          startsAt: new Date(String(form.get('startsAt'))).toISOString(),
          endsAt: new Date(String(form.get('endsAt'))).toISOString(), timezone: 'America/Sao_Paulo',
        });
        await loadLists(); setMessage('Evento cadastrado.'); formElement.reset();
      }); }}>
        <label>Cliente <select name="clientId" required><option value="">Selecione</option>{clients.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{' '}
        <label>Evento <input name="name" required minLength={3} /></label>{' '}
        <label>Local <input name="venue" required /></label>
        <label>Início <input name="startsAt" type="datetime-local" required /></label>{' '}
        <label>Fim <input name="endsAt" type="datetime-local" required /></label>{' '}
        <button>Cadastrar evento</button>
      </form>}
      <ul>{events.map(item => <li key={item.id}><a href={`/admin/events/${item.id}`}>{item.name} →</a> · {clients.find(c => c.id === item.clientId)?.name ?? 'sem cliente'} · {item.status}</li>)}</ul>
    </section>
    </div></div>
  </main>;
}
