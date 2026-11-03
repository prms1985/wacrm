// Coexistence events are imported separately from live incoming messages.
// In particular, historical customer messages must never start responders.
type Json = Record<string, unknown>;
export const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const phone = (value: unknown) => {
  const digits = text(value).replace(/[+\s().-]/g, '');
  return /^[1-9]\d{5,14}$/.test(digits) ? digits : '';
};
const userId = (value: unknown) =>
  /^\w[\w.:-]{4,255}$/.test(text(value)) && text(value).startsWith('US.')
    ? text(value)
    : '';

export function timestamp(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number(text(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  const millis = n > 1e12 ? n : n * 1000;
  // Do not allow malformed provider timestamps to reorder the inbox.
  if (millis < Date.UTC(2009, 0, 1) || millis > Date.now() + 86400000)
    return null;
  return new Date(millis).toISOString();
}

export interface ImportedMessage {
  message_id: string;
  phone: string;
  user_id: string;
  name: string;
  sender_type: 'agent' | 'customer';
  content_type: string;
  content_text: string;
  media_url: string | null;
  media_type: string | null;
  created_at: string;
  status: string;
  source: 'business_app' | 'history';
  placeholder: boolean;
}
export interface ImportedContact {
  phone: string;
  name: string;
  removed: boolean;
  changed_at: string;
}
export interface ImportBatch {
  messages: ImportedMessage[];
  contacts: ImportedContact[];
  history_status: 'syncing' | 'complete' | 'declined' | 'failed' | null;
  history_progress: number;
  error: string | null;
  disconnected: boolean;
}

export function isCoexistenceChange(field: string, value: unknown): boolean {
  if (['smb_message_echoes', 'smb_app_state_sync', 'history'].includes(field))
    return true;
  const v = object(value);
  if (field === 'account_update') return v.event === 'PARTNER_REMOVED';
  return false;
}

export function hasHistoryContext(message: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(
    object(message),
    'history_context'
  );
}

function message(
  raw: unknown,
  source: 'business_app' | 'history',
  peer?: unknown,
  outgoingEcho = false
): ImportedMessage | null {
  const m = object(raw),
    history = object(m.history_context),
    thread = object(peer);
  const historical = source === 'history' || hasHistoryContext(raw);
  const outgoing = outgoingEcho || !historical || history.from_me === true;
  const recipient = outgoing ? m.to : m.from;
  const contact = object(thread.contact);
  const peerPhone =
    phone(recipient) || phone(thread.id) || phone(contact.phone_number);
  const peerId =
    userId(outgoing ? m.to_user_id : m.from_user_id) ||
    userId(thread.id) ||
    userId(thread.user_id);
  const createdAt = timestamp(m.timestamp);
  if (!text(m.id) || !createdAt || (!peerPhone && !peerId)) return null;
  const kind = text(m.type);
  const media = object(m[kind]);
  const mediaId = text(media.id);
  const allowed = [
    'image',
    'video',
    'audio',
    'document',
    'location',
    'interactive',
    'template',
  ];
  const contentType =
    kind === 'sticker' ? 'image' : allowed.includes(kind) ? kind : 'text';
  let body = kind === 'text' ? text(object(m.text).body) : text(media.caption);
  if (kind === 'location')
    body = JSON.stringify({
      latitude: media.latitude,
      longitude: media.longitude,
      name: media.name,
      address: media.address,
    });
  if (kind === 'interactive')
    body ||=
      text(object(media.button_reply).title) ||
      text(object(media.list_reply).title);
  if (kind === 'button') body ||= text(object(m.button).text);
  if (kind === 'contacts')
    body ||= list(m.contacts)
      .map((c) => text(object(object(c).name).formatted_name))
      .filter(Boolean)
      .join(', ');
  if (!body && !mediaId)
    body =
      kind === 'media_placeholder'
        ? '[Media shared in WhatsApp Business]'
        : `[${kind || 'Unsupported WhatsApp message'}]`;
  return {
    message_id: text(m.id),
    phone: peerPhone,
    user_id: peerId,
    name: text(contact.full_name) || text(object(thread.profile).name),
    sender_type: outgoing ? 'agent' : 'customer',
    content_type: contentType,
    content_text: body,
    media_url: mediaId
      ? `/api/whatsapp/media/${encodeURIComponent(mediaId)}`
      : null,
    media_type: text(media.mime_type) || null,
    created_at: createdAt,
    status: ['sent', 'delivered', 'read', 'failed'].includes(
      text(history.status)
    )
      ? text(history.status)
      : outgoing
        ? 'sent'
        : 'delivered',
    source: historical ? 'history' : 'business_app',
    placeholder: kind === 'media_placeholder',
  };
}

export function parseCoexistenceChange(
  field: string,
  raw: unknown
): ImportBatch {
  const value = object(raw);
  const batch: ImportBatch = {
    messages: [],
    contacts: [],
    history_status: null,
    history_progress: 0,
    error: null,
    disconnected:
      field === 'account_update' && value.event === 'PARTNER_REMOVED',
  };
  if (field === 'smb_message_echoes') {
    for (const item of list(value.message_echoes)) {
      const parsed = message(item, 'business_app', undefined, true);
      if (parsed) batch.messages.push(parsed);
    }
  }
  if (field === 'history') {
    const errors = [
      ...list(value.errors),
      ...list(value.history).flatMap((h) => list(object(h).errors)),
    ];
    if (errors.length) {
      batch.history_status = errors.some(
        (e) => Number(object(e).code) === 2593109
      )
        ? 'declined'
        : 'failed';
      batch.error =
        batch.history_status === 'declined'
          ? null
          : 'WhatsApp could not share chat history. Check the connection in the Business app.';
    }
    for (const item of list(value.history)) {
      const chunk = object(item),
        metadata = object(chunk.metadata);
      const progress = Number(metadata.progress);
      if (Number.isFinite(progress))
        batch.history_progress = Math.max(
          batch.history_progress,
          Math.min(100, Math.max(0, progress))
        );
      if (!batch.history_status)
        batch.history_status =
          batch.history_progress === 100 ? 'complete' : 'syncing';
      if (batch.history_progress === 100 && batch.history_status === 'syncing')
        batch.history_status = 'complete';
      for (const thread of list(chunk.threads)) {
        for (const item of list(object(thread).messages)) {
          const parsed = message(item, 'history', thread);
          if (parsed) batch.messages.push(parsed);
        }
      }
    }
    // History media can arrive separately, with history_context attached.
    for (const item of list(value.messages)) {
      const parsed = message(item, 'history');
      if (parsed) batch.messages.push(parsed);
    }
    for (const item of list(value.message_echoes)) {
      const parsed = message(item, 'history', undefined, true);
      if (parsed) batch.messages.push(parsed);
    }
  }
  if (field === 'smb_app_state_sync') {
    for (const item of list(value.state_sync)) {
      const sync = object(item),
        contact = object(sync.contact);
      const number = phone(contact.phone_number),
        changedAt = timestamp(object(sync.metadata).timestamp);
      if (
        sync.type !== 'contact' ||
        !number ||
        !changedAt ||
        !['add', 'remove'].includes(text(sync.action))
      )
        continue;
      batch.contacts.push({
        phone: number,
        name: text(contact.full_name) || text(contact.first_name),
        removed: sync.action === 'remove',
        changed_at: changedAt,
      });
    }
  }
  return batch;
}
