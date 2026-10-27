import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

type Device = {
  created_at: string | null;
  windows_version: string | null;
  system_language: string | null;
  app_language: string | null;
  app_version: string | null;
  watch_model: string | null;
};

function normalizeWindowsVersion(value: string | null): {
  name: string;
  number: string;
} {
  if (!value) {
    return { name: "Unknown", number: "Unknown" };
  }

  // Remove build numbers, parenthesized details and release labels.
  const cleaned = value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bBuild\s*\d+\b/gi, " ")
    .replace(/\b\d{2}H[12]\b/gi, " ")
    .replace(/\b\d{4}H[12]\b/gi, " ")
    .replace(/\bVersion\s+\d[\w.]*/gi, " ")
    .replace(/\bMicrosoft\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleaned.match(
    /\bWindows\s+(\d+(?:\.\d+)?|XP|Vista)\b/i,
  );

  if (!match) {
    return { name: value.trim(), number: "Unknown" };
  }

  const number = match[1];
  const tail = cleaned.slice(match.index! + match[0].length).trim();

  // Recognize common Windows editions, preferring longer names.
  const editions = [
    "Enterprise LTSC",
    "Enterprise LTSB",
    "Enterprise N",
    "Enterprise",
    "Education N",
    "Education",
    "Pro for Workstations",
    "Pro Education",
    "Pro N",
    "Professional",
    "Pro",
    "Home Single Language",
    "Home N",
    "Home",
    "IoT Enterprise",
    "IoT Core",
    "Workstations",
    "Ultimate",
    "Starter",
    "Core",
    "Business",
    "Server",
  ];

  const normalizedTail = tail.replace(/\s+/g, " ").trim();
  const lowerTail = normalizedTail.toLowerCase();

  const edition = editions.find((candidate) =>
    new RegExp(
      "^" + candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=\\s|$)",
      "i",
    ).test(lowerTail)
  );

  const name = `Windows ${number}${edition ? ` ${edition}` : ""}`;

  return { name, number };
}

function languageName(value: string | null): string {
  if (!value?.trim()) return "Unknown";

  try {
    const locale = new Intl.Locale(value.trim());
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

    const languageTag = locale.script
      ? `${locale.language}-${locale.script}`
      : locale.language;

    const language = names.of(languageTag) ?? value;
    const region = locale.region ? regionNames.of(locale.region) : undefined;

    // Example: en-US -> English (United States)
    if (region && !language.toLowerCase().includes(region.toLowerCase())) {
      return `${language} (${region})`;
    }

    return language;
  } catch {
    return value;
  }
}

function languageNameGrouped(value: string | null): string {
  if (!value?.trim()) return "Unknown";

  try {
    const locale = new Intl.Locale(value.trim());
    const names = new Intl.DisplayNames(["en"], {
      type: "language",
    });

    return names.of(locale.language) ?? value;
  } catch {
    return value;
  }
}

function increment(
  counts: Record<string, number>,
  key: string,
): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function toSortedList(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

async function fetchDevices(): Promise<Device[]> {
  const pageSize = 1000;
  const devices: Device[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("devices")
      .select(
        "created_at,windows_version,system_language,app_language,app_version,watch_model",
      )
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const page = (data ?? []) as Device[];
    devices.push(...page);

    if (page.length < pageSize) break;
  }

  return devices;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Exact counts are computed by PostgreSQL.
    const [totalResult, sevenDaysResult, thirtyDaysResult, devices] =
      await Promise.all([
        supabase.from("devices").select("*", { count: "exact", head: true }),
        supabase.from("devices").select("*", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo),
        supabase.from("devices").select("*", { count: "exact", head: true })
          .gte("created_at", thirtyDaysAgo),
        fetchDevices(),
      ]);

    for (const result of [totalResult, sevenDaysResult, thirtyDaysResult]) {
      if (result.error) throw result.error;
    }

    const windowsVersions: Record<string, number> = {};
    const windowsNumbers: Record<string, number> = {};
    const windowsLanguages: Record<string, number> = {};
    const windowsLanguagesGrouped: Record<string, number> = {};
    const appLanguages: Record<string, number> = {};
    const appVersions: Record<string, number> = {};
    const watchModels: Record<string, number> = {};

    for (const device of devices) {
      const windows = normalizeWindowsVersion(device.windows_version);

      increment(windowsVersions, windows.name);
      increment(windowsNumbers, windows.number);
      increment(windowsLanguages, languageName(device.system_language));
      increment(windowsLanguagesGrouped, languageNameGrouped(device.system_language));
      increment(appLanguages, device.app_language?.trim() || "Not available");
      // Full versions like "18.1.0.0"; the site groups them to "18.1".
      increment(appVersions, device.app_version?.trim() || "Unknown");
      increment(watchModels, device.watch_model?.trim() || "Amazfit");
    }

    return Response.json(
      {
        generated_at: new Date().toISOString(),
        total_devices: totalResult.count ?? 0,
        new_devices_7_days: sevenDaysResult.count ?? 0,
        new_devices_30_days: thirtyDaysResult.count ?? 0,
        windows_versions: toSortedList(windowsVersions),
        windows_by_number: toSortedList(windowsNumbers),
        windows_languages: toSortedList(windowsLanguages),
        windows_languages_grouped: toSortedList(windowsLanguagesGrouped),
        app_languages: toSortedList(appLanguages),
        app_versions: toSortedList(appVersions),
        watch_models: toSortedList(watchModels),
      },
      {
        headers: {
          ...corsHeaders,
          "Cache-Control": "public, max-age=60",
        },
      },
    );
  } catch (error) {
    console.error("public-device-stats error:", error);

    return Response.json(
      { error: "Unable to load public statistics" },
      { status: 500, headers: corsHeaders },
    );
  }
});
