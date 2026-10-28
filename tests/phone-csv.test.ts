import { describe, expect, it } from "vitest";
import {
  isGroupChatId,
  normalizeChatId,
  phoneFromChatId,
  sanitizePhone,
  toChatId,
  toLatinDigits,
} from "../src/shared/utils/phone";
import {
  escapeCsvCell,
  neutralizeFormula,
  parseCsv,
  recipientsFromRows,
  rowsFromMatrix,
  toCsv,
} from "../src/shared/utils/csv";

describe("phone sanitizer", () => {
  it("normalises international and local formats", () => {
    expect(sanitizePhone("+966 50 123 4567")).toMatchObject({
      digits: "966501234567",
      chatId: "966501234567@c.us",
      valid: true,
    });
    expect(sanitizePhone("00966 50 123 4567").digits).toBe("966501234567");
    expect(sanitizePhone("0501234567", "966").digits).toBe("966501234567");
    expect(sanitizePhone("966501234567", "966").digits).toBe("966501234567");
    expect(sanitizePhone("(966) 055-555-5555", "966").digits).toBe("966555555555");
    expect(sanitizePhone("0501234567", "966").chatId).toBe("966501234567@c.us");
  });

  it("converts Arabic-Indic digits", () => {
    expect(toLatinDigits("٠٥٠١٢٣٤٥٦٧")).toBe("0501234567");
    expect(sanitizePhone("٠٥٠١٢٣٤٥٦٧", "966").digits).toBe("966501234567");
  });

  it("rejects invalid, group and unsupported identifiers", () => {
    expect(sanitizePhone("").valid).toBe(false);
    expect(sanitizePhone("12345").valid).toBe(false);
    expect(sanitizePhone("1234567890123456").valid).toBe(false);
    expect(sanitizePhone("123@g.us").reason).toBe("group-id");
    expect(sanitizePhone("120363021234567890@newsletter").valid).toBe(false);
  });

  it("exposes chat-id helpers", () => {
    expect(toChatId("+966501234567")).toBe("966501234567@c.us");
    expect(toChatId("invalid")).toBe("");
    expect(phoneFromChatId("966501234567@c.us")).toBe("966501234567");
    expect(phoneFromChatId("1203630@g.us")).toBe("1203630");
    expect(isGroupChatId("1203630@g.us")).toBe(true);
    expect(isGroupChatId("966501234567@c.us")).toBe(false);
    expect(normalizeChatId("0501234567", "966")).toBe("966501234567@c.us");
    expect(normalizeChatId("1203630@g.us")).toBe("1203630@g.us");
  });
});

describe("CSV parser", () => {
  it("handles BOM, quoted Arabic values, embedded commas and newlines", () => {
    const csv =
      '\uFEFFname,phone,note\r\n"أحمد, علي",+966 50 123 4567,"سطر\r\nثاني"\r\n"خالد","",عادي\r\n';
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(["name", "phone", "note"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.name).toBe("أحمد, علي");
    expect(parsed.rows[0]?.note).toBe("سطر\r\nثاني");
    expect(parsed.rows[1]?.phone).toBe("");
  });

  it("detects semicolon-separated files", () => {
    const parsed = parseCsv("phone;name\n966501234567;سارة\n");
    expect(parsed.delimiter).toBe(";");
    expect(parsed.rows[0]?.name).toBe("سارة");
  });

  it("builds recipients from Arabic headers with dedupe and validation", () => {
    const csv = [
      "الاسم,رقم الهاتف,ملاحظة",
      "أحمد,0501234567,عميل جديد",
      "أحمد مكرر,+966501234567,تكرار",
      "سارة,+966 55 555 5555,مهمة",
      "خطأ,123,قصير",
      "بلا هاتف,,فارغ",
    ].join("\n");
    const parsed = parseCsv(csv);
    const result = recipientsFromRows(parsed.headers, parsed.rows, "966");

    expect(result.phoneColumn).toBe("رقم الهاتف");
    expect(result.recipients).toHaveLength(2);
    expect(result.recipients[0]).toMatchObject({
      phone: "966501234567",
      chatId: "966501234567@c.us",
      name: "أحمد",
      custom1: "عميل جديد",
    });
    expect(result.recipients[1]?.phone).toBe("966555555555");
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.value).toBe("123");
  });

  it("converts an xlsx-style matrix", () => {
    const matrix: unknown[][] = [
      ["phone", "name", "custom1"],
      [966501234567, "ليان", "VIP"],
      [null, null, null],
      ["966555555555", "عمر", ""],
    ];
    const parsed = rowsFromMatrix(matrix);
    expect(parsed.headers).toEqual(["phone", "name", "custom1"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.phone).toBe("966501234567");
    expect(parsed.rows[1]?.name).toBe("عمر");
  });

  it("escapes CSV cells and neutralises spreadsheet formulas", () => {
    expect(neutralizeFormula("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(neutralizeFormula("+966501234567")).toBe("'+966501234567");
    expect(neutralizeFormula("مرحبا")).toBe("مرحبا");
    expect(escapeCsvCell('a"b,c')).toBe('"a""b,c"');

    const csv = toCsv(
      ["name", "phone"],
      [
        ["=1+1", "+966501234567"],
        ["أحمد, علي", "966555555555"],
      ],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+966501234567");
    expect(csv).toContain('"أحمد, علي"');
  });
});
