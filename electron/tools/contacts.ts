import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

export interface Contact {
  id: string;
  name: string;
  aliases: string[];
  phone?: string;
  whatsapp?: string;
  email?: string;
  notes?: string;
}

interface ScoredContact {
  contact: Contact;
  score: number;
}

/**
 * =========================================================
 * CONTACTS.JSON PATH
 * =========================================================
 */

async function getContactsFilePath(): Promise<string> {
  const userDataPath = app.getPath("userData");

  await fs.mkdir(userDataPath, {
    recursive: true,
  });

  const userDataFile = path.join(
    userDataPath,
    "contacts.json"
  );

  // First run: copy root contacts.json into Electron userData
  try {
    await fs.access(userDataFile);
    return userDataFile;
  } catch {
    // File does not exist yet
  }

  const rootFile = path.resolve(
    process.cwd(),
    "contacts.json"
  );

  try {
    await fs.copyFile(rootFile, userDataFile);
    console.log(
      "Contacts copied to:",
      userDataFile
    );
  } catch {
    await fs.writeFile(
      userDataFile,
      JSON.stringify(
        { contacts: [] },
        null,
        2
      ),
      "utf-8"
    );
  }

  return userDataFile;
}

/**
 * =========================================================
 * LOAD CONTACTS
 * Supports:
 * { "contacts": [...] }
 * and
 * [...]
 * =========================================================
 */

async function loadContacts(): Promise<Contact[]> {
  const filePath =
    await getContactsFilePath();

  try {
    const data = await fs.readFile(
      filePath,
      "utf-8"
    );

    if (!data.trim()) {
      return [];
    }

    const parsed = JSON.parse(data);

    // Your contacts.json format
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.contacts)
    ) {
      return parsed.contacts;
    }

    // Also support plain array
    if (Array.isArray(parsed)) {
      return parsed;
    }

    console.error(
      "Invalid contacts.json format."
    );

    return [];
  } catch (error: any) {
    console.error(
      "Failed to read contacts.json:",
      error
    );

    return [];
  }
}

/**
 * =========================================================
 * SAVE CONTACTS
 * =========================================================
 */

async function saveContacts(
  contacts: Contact[]
): Promise<void> {
  const filePath =
    await getContactsFilePath();

  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        contacts,
      },
      null,
      2
    ),
    "utf-8"
  );
}

/**
 * =========================================================
 * PHONE NORMALIZATION
 * =========================================================
 */

export function normalizeIndianPhone(
  phone: string
): {
  normalized: string;
  valid: boolean;
} {
  const digits = String(phone || "")
    .replace(/\D/g, "");

  if (digits.length === 10) {
    return {
      normalized: `91${digits}`,
      valid: true,
    };
  }

  if (
    digits.length === 12 &&
    digits.startsWith("91")
  ) {
    return {
      normalized: digits,
      valid: true,
    };
  }

  return {
    normalized: digits,
    valid: false,
  };
}

/**
 * =========================================================
 * STRING SIMILARITY
 * =========================================================
 */

function similarity(
  a: string,
  b: string
): number {
  const x = String(a || "")
    .toLowerCase()
    .trim();

  const y = String(b || "")
    .toLowerCase()
    .trim();

  if (!x || !y) {
    return 0;
  }

  if (x === y) {
    return 100;
  }

  if (
    x.includes(y) ||
    y.includes(x)
  ) {
    return 90;
  }

  const distance =
    levenshteinDistance(x, y);

  const maxLength =
    Math.max(
      x.length,
      y.length
    );

  if (maxLength === 0) {
    return 100;
  }

  return Math.max(
    0,
    Math.round(
      (1 - distance / maxLength) *
        100
    )
  );
}

function levenshteinDistance(
  a: string,
  b: string
): number {
  const matrix: number[][] = [];

  for (
    let i = 0;
    i <= b.length;
    i++
  ) {
    matrix[i] = [i];
  }

  for (
    let j = 0;
    j <= a.length;
    j++
  ) {
    matrix[0][j] = j;
  }

  for (
    let i = 1;
    i <= b.length;
    i++
  ) {
    for (
      let j = 1;
      j <= a.length;
      j++
    ) {
      if (
        b.charAt(i - 1) ===
        a.charAt(j - 1)
      ) {
        matrix[i][j] =
          matrix[i - 1][j - 1];
      } else {
        matrix[i][j] =
          Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * =========================================================
 * RESOLVE CONTACT
 * IMPORTANT: exported because nodeTools.ts imports it
 * =========================================================
 */

export async function resolveContact(
  query: string
): Promise<{
  matches: Contact[];
  exact: boolean;
}> {
  const contacts =
    await loadContacts();

  const cleanQuery = String(
    query || ""
  )
    .toLowerCase()
    .trim();

  if (!cleanQuery) {
    return {
      matches: [],
      exact: false,
    };
  }

  const normalizedQuery =
    normalizeIndianPhone(
      cleanQuery
    );

  const scored: ScoredContact[] =
    contacts
      .map((contact) => {
        let score =
          similarity(
            cleanQuery,
            contact.name
          );

        for (
          const alias of
            contact.aliases || []
        ) {
          score = Math.max(
            score,
            similarity(
              cleanQuery,
              alias
            )
          );
        }

        if (
          contact.phone &&
          (
            cleanQuery ===
              contact.phone ||
            normalizedQuery.normalized ===
              normalizeIndianPhone(
                contact.phone
              ).normalized
          )
        ) {
          score = 100;
        }

        if (
          contact.whatsapp &&
          (
            cleanQuery ===
              contact.whatsapp ||
            normalizedQuery.normalized ===
              normalizeIndianPhone(
                contact.whatsapp
              ).normalized
          )
        ) {
          score = 100;
        }

        return {
          contact,
          score,
        };
      })
      .filter(
        (item) => item.score > 30
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  if (scored.length === 0) {
    return {
      matches: [],
      exact: false,
    };
  }

  const top =
    scored[0].score;

  if (
    top >= 85 &&
    (
      scored.length === 1 ||
      top -
        scored[1].score >=
        15
    )
  ) {
    return {
      matches: [
        scored[0].contact,
      ],
      exact: true,
    };
  }

  const band =
    scored.filter(
      (item) =>
        item.score >=
        top - 10
    );

  return {
    matches:
      band.map(
        (item) =>
          item.contact
      ),
    exact: false,
  };
}

/**
 * =========================================================
 * ADD CONTACT
 * =========================================================
 */

export async function addContact(
  args: Partial<Contact> & {
    name: string;
  }
) {
  if (!args?.name) {
    return {
      success: false,
      tool: "add_contact",
      error:
        "Need at least a name to save a contact.",
    };
  }

  const contacts =
    await loadContacts();

  let phone:
    | string
    | undefined;

  if (args.phone) {
    const result =
      normalizeIndianPhone(
        args.phone
      );

    if (!result.valid) {
      return {
        success: false,
        tool: "add_contact",
        error:
          `"${args.phone}" doesn't look like a valid Indian phone number.`,
      };
    }

    phone =
      result.normalized;
  }

  let whatsapp:
    | string
    | undefined;

  if (args.whatsapp) {
    const result =
      normalizeIndianPhone(
        args.whatsapp
      );

    if (!result.valid) {
      return {
        success: false,
        tool: "add_contact",
        error:
          `"${args.whatsapp}" doesn't look like a valid Indian WhatsApp number.`,
      };
    }

    whatsapp =
      result.normalized;
  } else {
    whatsapp = phone;
  }

  const existingIdx =
    contacts.findIndex(
      (contact) =>
        contact.name
          .toLowerCase() ===
        args.name
          .toLowerCase()
    );

  const existing =
    existingIdx >= 0
      ? contacts[existingIdx]
      : undefined;

  const contact: Contact = {
    id:
      existing?.id ??
      `c_${Date.now().toString(36)}`,

    name: args.name,

    aliases:
      args.aliases ??
      existing?.aliases ??
      [],

    phone:
      phone ??
      existing?.phone,

    whatsapp:
      whatsapp ??
      existing?.whatsapp,

    email:
      args.email ??
      existing?.email,

    notes:
      args.notes ??
      existing?.notes,
  };

  if (existingIdx >= 0) {
    contacts[existingIdx] =
      contact;
  } else {
    contacts.push(contact);
  }

  await saveContacts(
    contacts
  );

  return {
    success: true,
    tool: "add_contact",
    contact,
  };
}

/**
 * =========================================================
 * DELETE CONTACT
 * =========================================================
 */

export async function deleteContact(
  args: {
    name: string;
  }
) {
  const contacts =
    await loadContacts();

  const name = String(
    args?.name || ""
  )
    .toLowerCase()
    .trim();

  const next =
    contacts.filter(
      (contact) =>
        contact.name
          .toLowerCase() !==
        name
    );

  await saveContacts(
    next
  );

  return {
    success: true,
    tool: "delete_contact",
    deleted:
      next.length !==
      contacts.length,
    name: args?.name,
  };
}

/**
 * =========================================================
 * LIST CONTACTS
 * =========================================================
 */

export async function listContacts() {
  const contacts =
    await loadContacts();

  return {
    success: true,
    tool: "list_contacts",

    contacts:
      contacts.map(
        (contact) => ({
          name:
            contact.name,
          aliases:
            contact.aliases,
          phone:
            contact.phone,
          whatsapp:
            contact.whatsapp,
          email:
            contact.email,
          notes:
            contact.notes,
        })
      ),
  };
}

/**
 * =========================================================
 * RESOLVE CONTACT TOOL
 * =========================================================
 */

export async function resolveContactTool(
  args: {
    query: string;
  }
) {
  const query = String(
    args?.query || ""
  ).trim();

  const result =
    await resolveContact(
      query
    );

  if (
    result.matches.length ===
    0
  ) {
    return {
      success: false,
      tool: "resolve_contact",

      error:
        `No saved contact matches "${query}".`,

      needsNewContact: true,
    };
  }

  if (
    !result.exact &&
    result.matches.length > 1
  ) {
    return {
      success: false,
      tool: "resolve_contact",

      ambiguous: true,

      candidates:
        result.matches.map(
          (contact) =>
            contact.name
        ),

      note:
        `Found ${result.matches.length} possible matches for "${query}" — ask the user which one they mean.`,
    };
  }

  return {
    success: true,
    tool: "resolve_contact",
    contact:
      result.matches[0],
  };
}

/**
 * =========================================================
 * CONTACTS FILE PATH
 * =========================================================
 */

export async function getContactsPath() {
  return {
    success: true,
    path:
      await getContactsFilePath(),
  };
}