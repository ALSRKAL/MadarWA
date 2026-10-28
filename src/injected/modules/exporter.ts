import type { ContactRow, GroupParticipantRow, GroupSummary } from "../../shared/types";
import { formatPhone, isGroupChatId, isUserChatId, phoneFromChatId } from "../../shared/utils/phone";
import {
  chatDisplayName,
  groupParticipantsCount,
  mapLimit,
  resolvePhone,
  widToId,
  type WppApi,
  type WppChat,
  type WppContact,
} from "../wpp";

function contactName(contact: WppContact | undefined): string {
  if (!contact) return "";
  return String(contact.name ?? contact.pushname ?? contact.shortName ?? contact.formattedName ?? "").trim();
}

/**
 * LID accounts only expose a numeric LID unless wa-js can resolve the PN.
 * Never present that LID as an international phone number.
 */
async function resolveDisplayPhone(wpp: WppApi, id: string): Promise<string> {
  const raw = phoneFromChatId(id);
  if (!id.endsWith("@lid")) return raw;
  const resolved = await resolvePhone(wpp, id);
  return resolved && resolved !== raw ? resolved : "";
}

function displayName(contact: WppContact | undefined, phone: string, id: string): string {
  return contactName(contact) || (phone ? formatPhone(phone) : "") || id;
}

export async function listGroups(wpp: WppApi): Promise<GroupSummary[]> {
  const groups = await wpp.group.getAllGroups();
  return groups
    .filter((chat): chat is WppChat => Boolean(chat?.id))
    .map((chat) => {
      const id = widToId(chat.id);
      return {
        id,
        name: chat.name || chat.formattedTitle || chat.subject || chat.contact?.name || chat.groupMetadata?.subject || id,
        participantsCount: groupParticipantsCount(chat),
      };
    })
    .filter((group) => group.id)
    .sort((left, right) => left.name.localeCompare(right.name, "ar"));
}

export async function listGroupParticipants(wpp: WppApi, groupId: string): Promise<GroupParticipantRow[]> {
  const groupName = chatDisplayName(wpp, groupId);
  const participants = await wpp.group.getParticipants(groupId);

  const rows = await mapLimit(participants, 6, async (participant) => {
    const id = widToId(participant.id);
    if (!id || !isUserChatId(id)) return null;
    let contact: WppContact | undefined;
    try {
      contact = await wpp.contact.get(id);
    } catch {
      contact = undefined;
    }
    const phone = await resolveDisplayPhone(wpp, id);
    const row: GroupParticipantRow = {
      id,
      phone,
      formattedPhone: phone ? formatPhone(phone) : "",
      name: displayName(contact, phone, id),
      isMyContact: Boolean(contact?.isMyContact),
      isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin),
      isSuperAdmin: Boolean(participant.isSuperAdmin),
      groupId,
      groupName,
    };
    return row;
  });

  return rows.filter((row): row is GroupParticipantRow => row !== null);
}

export async function listContacts(wpp: WppApi, onlyMyContacts: boolean): Promise<ContactRow[]> {
  const contacts = await wpp.contact.list({ onlyMyContacts });
  const seen = new Set<string>();
  const rows: ContactRow[] = [];

  for (const contact of contacts) {
    const id = widToId(contact.id);
    if (!id || !isUserChatId(id) || seen.has(id)) continue;
    const phone = await resolveDisplayPhone(wpp, id);
    seen.add(id);
    rows.push({
      id,
      phone,
      formattedPhone: phone ? formatPhone(phone) : "",
      name: displayName(contact, phone, id),
      isMyContact: Boolean(contact.isMyContact ?? onlyMyContacts),
    });
  }

  return rows.sort((left, right) => left.name.localeCompare(right.name, "ar") || left.phone.localeCompare(right.phone));
}

export async function listChats(wpp: WppApi): Promise<ContactRow[]> {
  const chats = await wpp.chat.list({ onlyUsers: true });
  const seen = new Set<string>();
  const rows: ContactRow[] = [];

  for (const chat of chats) {
    const id = widToId(chat.id);
    if (!id || !isUserChatId(id) || isGroupChatId(id) || seen.has(id)) continue;
    seen.add(id);
    const phone = await resolveDisplayPhone(wpp, id);
    const name = String(chat.name || chat.formattedTitle || chat.contact?.name || "").trim();
    rows.push({
      id,
      phone,
      formattedPhone: phone ? formatPhone(phone) : "",
      name: name || (phone ? formatPhone(phone) : id),
      isMyContact: Boolean(chat.contact?.name),
    });
  }

  return rows.sort((left, right) => left.name.localeCompare(right.name, "ar") || left.phone.localeCompare(right.phone));
}
