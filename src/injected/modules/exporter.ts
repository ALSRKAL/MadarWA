import type { ContactRow, GroupParticipantRow, GroupSummary } from "../../shared/types";
import { phoneFromChatId, isGroupChatId, isUserChatId } from "../../shared/utils/phone";
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
  return String(contact.name ?? contact.pushname ?? contact.shortName ?? contact.formattedName ?? "");
}

export async function listGroups(wpp: WppApi): Promise<GroupSummary[]> {
  const groups = await wpp.group.getAllGroups();
  return groups
    .filter((chat): chat is WppChat => Boolean(chat?.id))
    .map((chat) => {
      const id = widToId(chat.id);
      return {
        id,
        name: chat.name || chat.formattedTitle || chat.groupMetadata?.subject || id,
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
    const phone = await resolvePhone(wpp, id);
    const row: GroupParticipantRow = {
      id,
      phone: phone || phoneFromChatId(id),
      name: contactName(contact),
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
    const phone = phoneFromChatId(id) || (await resolvePhone(wpp, id));
    if (!phone) continue;
    seen.add(id);
    rows.push({
      id,
      phone,
      name: contactName(contact),
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
    let phone = phoneFromChatId(id);
    if (!phone) phone = await resolvePhone(wpp, id);
    if (!phone) continue;
    rows.push({
      id,
      phone,
      name: chat.name || chat.formattedTitle || "",
      isMyContact: false,
    });
  }

  return rows.sort((left, right) => left.name.localeCompare(right.name, "ar") || left.phone.localeCompare(right.phone));
}
