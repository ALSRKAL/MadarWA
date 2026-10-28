import { describe, expect, it } from "vitest";
import type { WppApi } from "../src/injected/wpp";
import { listChats, listContacts, listGroupParticipants, listGroups } from "../src/injected/modules/exporter";

function fakeApi(options: { lidResolution?: "mapped" | "unmapped" } = {}): WppApi {
  const groupChat = {
    id: { _serialized: "120363000000000000@g.us" },
    subject: "مجموعة العمل العربية",
    contact: { name: "فريق المدار" },
    groupMetadata: { participants: { length: 2 } },
  };

  return {
    chat: {
      list: async () => [
        { id: { _serialized: "966511111111@c.us" }, name: "سارة العتيبي" },
        { id: { _serialized: "987654321@lid" }, contact: { name: "LID Chat" } },
      ],
      get: () => undefined,
    },
    contact: {
      get: async (id: string) => {
        if (id === "966501234567@c.us") return { id: { _serialized: id }, name: "أحمد", isMyContact: true };
        if (id === "987654321@lid") return { id: { _serialized: id }, pushname: "LID User" };
        if (id === "555000111@lid") return { id: { _serialized: id }, pushname: "LID User" };
        if (id === "999999999@lid") return { id: { _serialized: id }, pushname: "Unknown LID" };
        return undefined;
      },
      list: async () => [
        { id: { _serialized: "966501234567@c.us" }, name: "أحمد", isMyContact: true },
        { id: { _serialized: "987654321@lid" }, pushname: "LID User" },
      ],
      getPnLidEntry: async (id: string | { _serialized?: string }) => {
        const serialized = typeof id === "string" ? id : id._serialized ?? "";
        if (serialized === "987654321@lid" && options.lidResolution === "mapped") {
          return { phoneNumber: { _serialized: "966555555555@c.us" } };
        }
        if (serialized === "555000111@lid") {
          return { phoneNumber: { _serialized: "966555000111@c.us" } };
        }
        throw new Error("unmapped");
      },
    },
    group: {
      getAllGroups: async () => [groupChat],
      getParticipants: async () => [
        { id: { _serialized: "966501234567@c.us" }, isAdmin: true, isSuperAdmin: false },
        { id: { _serialized: "555000111@lid" }, isAdmin: false, isSuperAdmin: false },
        { id: { _serialized: "999999999@lid" }, isAdmin: false, isSuperAdmin: false },
      ],
    },
  } as unknown as WppApi;
}

describe("exporter serialization", () => {
  it("serializes Arabic group names from subject/contact fallbacks", async () => {
    const groups = await listGroups(fakeApi());
    expect(groups[0]).toMatchObject({
      id: "120363000000000000@g.us",
      name: "مجموعة العمل العربية",
      participantsCount: 2,
    });
    expect(groups[0]?.name).not.toContain("[object Object]");
  });

  it("formats participant phones with + and resolves LID to a phone number", async () => {
    const rows = await listGroupParticipants(fakeApi(), "120363000000000000@g.us");
    const phoneRow = rows.find((row) => row.id === "966501234567@c.us");
    const lidRow = rows.find((row) => row.id === "555000111@lid");

    expect(phoneRow).toMatchObject({
      phone: "966501234567",
      formattedPhone: "+966501234567",
      name: "أحمد",
      isAdmin: true,
    });
    expect(lidRow).toMatchObject({
      phone: "966555000111",
      formattedPhone: "+966555000111",
      name: "LID User",
      isAdmin: false,
    });
  });

  it("never presents an unresolved LID as an international phone number", async () => {
    const rows = await listGroupParticipants(fakeApi({ lidResolution: "unmapped" }), "120363000000000000@g.us");
    const lidRow = rows.find((row) => row.id === "999999999@lid");
    expect(lidRow?.phone).toBe("");
    expect(lidRow?.formattedPhone).toBe("");
    expect(lidRow?.name).toBe("Unknown LID");
  });

  it("keeps Arabic contact names and formatted phones", async () => {
    const rows = await listContacts(fakeApi(), true);
    expect(rows[0]).toMatchObject({
      id: "966501234567@c.us",
      phone: "966501234567",
      formattedPhone: "+966501234567",
      name: "أحمد",
    });
    const lid = rows.find((row) => row.id === "987654321@lid");
    expect(lid?.formattedPhone).toBe("");
    expect(lid?.name).toBe("LID User");
    expect(rows.every((row) => !row.name.includes("[object Object]"))).toBe(true);
  });

  it("serializes chat names and +phone fallbacks", async () => {
    const rows = await listChats(fakeApi());
    expect(rows[0]).toMatchObject({
      id: "966511111111@c.us",
      formattedPhone: "+966511111111",
      name: "سارة العتيبي",
    });
    expect(rows.every((row) => !row.name.includes("[object Object]"))).toBe(true);
  });
});
