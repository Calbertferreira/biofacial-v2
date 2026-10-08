export type ApiProblem = {
  error?: string;
  details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
};

const fieldNames: Record<string, string> = {
  name: 'nome', email: 'e-mail', password: 'senha', currentPassword: 'senha temporária',
  newPassword: 'nova senha', temporaryPassword: 'senha temporária', clientId: 'cliente',
  clientIds: 'clientes permitidos', role: 'perfil', venue: 'local', startsAt: 'início',
  endsAt: 'fim', timezone: 'fuso horário', phoneE164: 'celular', guestIds: 'convidados',
  channels: 'canais de envio',
};

const explanations: Record<string, string> = {
  unauthorized: 'Sua sessão terminou. Entre novamente para continuar.',
  invalid_credentials: 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
  current_password_required: 'Informe a senha temporária.',
  new_password_required: 'Informe a nova senha.',
  new_password_too_short: 'A nova senha precisa ter pelo menos 12 caracteres.',
  new_password_too_long: 'A nova senha pode ter no máximo 128 caracteres.',
  new_password_must_differ: 'A nova senha deve ser diferente da senha temporária.',
  temporarily_locked: 'Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.',
  password_change_required: 'Altere sua senha temporária antes de continuar.',
  forbidden: 'Sua conta não tem permissão para realizar esta ação.',
  forbidden_client: 'Sua conta não tem permissão para este cliente.',
  forbidden_client_or_role: 'Sua conta não pode cadastrar esse perfil ou acessar os clientes selecionados.',
  client_id_required: 'Selecione o cliente responsável pelo evento.',
  invalid_client_id: 'O cliente selecionado não existe ou está inativo. Escolha outro.',
  invalid_client_ids: 'Selecione pelo menos um cliente ativo permitido para este usuário.',
  email_already_exists: 'Este e-mail já está cadastrado. Use outro e-mail.',
  guest_already_exists: 'Esta pessoa já está na lista de convidados deste evento.',
  event_external_id_exists: 'Já existe um evento com este identificador externo.',
  invalid_event_period: 'O fim do evento deve ser posterior ao início.',
  event_not_found: 'Este evento não foi encontrado. Atualize a página e tente novamente.',
  client_not_found: 'Este cliente não foi encontrado. Atualize a página e tente novamente.',
  user_not_found: 'Este usuário não foi encontrado. Atualize a página e tente novamente.',
  guest_not_found: 'Este convidado não foi encontrado. Atualize a página e tente novamente.',
  event_not_activatable: 'Este evento não pode ser ativado no estado atual.',
  event_not_active: 'Este evento não está ativo. Ative o evento antes de finalizá-lo.',
  event_unavailable: 'Este evento foi encerrado ou cancelado. Não é possível enviar convites.',
  invitation_unavailable: 'Este convite não está mais disponível para envio.',
  invitation_app_unavailable: 'O site de convites está indisponível. Procure o administrador.',
  missing_destination: 'O convidado não possui o contato necessário para o canal escolhido.',
  contact_required: 'Informe um e-mail ou celular para o convidado.',
  last_admin: 'Não é possível remover o último administrador ativo.',
  invalid_event_id: 'O identificador do evento é inválido. Abra o evento novamente.',
  invalid_input: 'Confira os campos informados e tente novamente.',
};

export function apiErrorMessage(problem: ApiProblem, fallback = 'Não foi possível concluir a operação. Tente novamente.'): string {
  if (problem.error === 'invalid_input') {
    const invalidField = Object.entries(problem.details?.fieldErrors ?? {}).find(([, errors]) => errors.length > 0)?.[0];
    if (invalidField) return `Confira o campo ${fieldNames[invalidField] ?? invalidField} e tente novamente.`;
    if (problem.details?.formErrors?.length) return 'Confira os dados informados e tente novamente.';
  }
  return problem.error ? explanations[problem.error] ?? fallback : fallback;
}

export async function requestJson<T = any>(path: string, options: RequestInit, overrides?: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.');
  }
  let body: Record<string, unknown>;
  try {
    body = await response.json();
  } catch {
    throw new Error('O servidor respondeu de forma inesperada. Tente novamente em instantes.');
  }
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : '';
    throw new Error(overrides?.[code] ?? apiErrorMessage(body as ApiProblem));
  }
  return body as T;
}

export function deliveryErrorMessage(code: string | null): string {
  const messages: Record<string, string> = {
    email_not_configured: 'O envio por e-mail ainda não está configurado.',
    whatsapp_not_configured: 'O envio por WhatsApp ainda não está configurado.',
    missing_destination: 'O convidado não tem contato para este canal.',
  };
  if (!code) return 'Não foi possível concluir o envio.';
  if (messages[code]) return messages[code];
  const providerError = /^(email|whatsapp)_provider_http_(\d{3})$/.exec(code);
  if (providerError) {
    const channel = providerError[1] === 'email' ? 'e-mail' : 'WhatsApp';
    const status = Number(providerError[2]);
    if (status === 401 || status === 403) return `A credencial do serviço de ${channel} foi recusada. Procure o administrador.`;
    if (status === 429) return `O serviço de ${channel} atingiu o limite de envios. Tente novamente mais tarde.`;
    if (status >= 500) return `O serviço de ${channel} está indisponível. Tente novamente mais tarde.`;
    return `O serviço de ${channel} recusou os dados do convite. Confira a configuração e o destinatário.`;
  }
  if (/timeout|abort/i.test(code)) return 'O serviço de envio demorou a responder. Tente novamente.';
  if (/fetch failed|network/i.test(code)) return 'Não foi possível conectar ao serviço de envio. Tente novamente.';
  return 'O serviço de envio recusou o convite. Consulte o administrador.';
}

export function accessReasonMessage(code: string | null): string {
  const reasons: Record<string, string> = {
    no_match: 'Rosto não encontrado entre os convidados.',
    review: 'Identificação facial inconclusiva.',
    already_inside: 'Entrada já registrada para este convidado.',
    not_inside: 'Este convidado ainda não registrou entrada.',
    guest_not_eligible: 'Convite não aceito ou cadastro facial ausente.',
    invalid_capture: 'A imagem capturada não pôde ser analisada.',
  };
  return code ? reasons[code] ?? 'Acesso negado. Confira o convite e o cadastro.' : 'Motivo não informado.';
}

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function validateForm(form: HTMLFormElement): string | null {
  const fields = Array.from(form.querySelectorAll<FormField>('input, select, textarea'));
  for (const field of fields) {
    if (field.disabled || field.type === 'hidden' || field.type === 'checkbox') continue;
    const label = field.labels?.[0]?.textContent?.trim() || fieldNames[field.name] || 'obrigatório';
    const name = label.replace(/\s+/g, ' ').replace(/[.:]$/, '');
    const minLength = 'minLength' in field ? field.minLength : -1;
    const maxLength = 'maxLength' in field ? field.maxLength : -1;
    let message: string | null = null;
    if (field.required && !field.value.trim()) message = `Preencha o campo ${name}.`;
    else if (field.validity.typeMismatch || field.type === 'email' && field.value && !field.validity.valid) message = `Informe um e-mail válido no campo ${name}.`;
    else if (field.validity.tooShort || minLength > 0 && field.value.length > 0 && field.value.length < minLength) message = `O campo ${name} precisa ter pelo menos ${minLength} caracteres.`;
    else if (field.validity.tooLong || maxLength > 0 && field.value.length > maxLength) message = `O campo ${name} aceita no máximo ${maxLength} caracteres.`;
    else if (field.validity.patternMismatch) message = `Confira o formato do campo ${name}.`;
    else if (!field.validity.valid) message = `Confira o campo ${name}.`;
    if (message) { field.focus(); return message; }
  }
  return null;
}
