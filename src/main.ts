import { task } from "@renderinc/sdk/workflows";
import OpenAI from "openai";

const openai = new OpenAI();

// ---------------------------------------------------------------------------
// Shared types — all fields must be JSON-serializable (SDK constraint)
// ---------------------------------------------------------------------------

type LocationContext = {
  lat: number;
  lng: number;
  radiusKm: number;
  summary: string;
  keyFeatures: string[];
  demographicNotes: string;
};

type AudienceProfile = {
  primarySegment: string;
  tone: string;
  localConcerns: string[];
};

type WeatherData = {
  temperatureF: number;
  windSpeedMph: number;
  humidity: number;
  condition: string;
};

type BroadcastDraft = {
  locationContext: LocationContext;
  audienceProfile: AudienceProfile;
  weather: WeatherData;
  headlines: string[];
  script: string;
  callToAction: string;
  estimatedReadTimeSecs: number;
};

// ---------------------------------------------------------------------------
// Task 1 — Analyze the location
// ---------------------------------------------------------------------------

const analyzeLocation = task(
  { name: "analyzeLocation" },
  async function analyzeLocation(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<LocationContext> {
    console.log(`[analyzeLocation] (${lat}, ${lng}) radius=${radiusKm}km`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a geographic analyst for a geo-targeted broadcast platform. " +
            "Return structured JSON describing the given coordinates.",
        },
        {
          role: "user",
          content:
            `Analyze the location at coordinates (${lat}, ${lng}) with a broadcast radius of ${radiusKm}km. ` +
            "Return a JSON object with exactly these keys: " +
            '"summary" (1-2 sentence plain-text description of the area), ' +
            '"keyFeatures" (array of 3-5 notable geographic or civic features), ' +
            '"demographicNotes" (1 sentence describing the typical local population).',
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");

    return {
      lat,
      lng,
      radiusKm,
      summary: parsed.summary ?? "",
      keyFeatures: parsed.keyFeatures ?? [],
      demographicNotes: parsed.demographicNotes ?? "",
    };
  },
);

// ---------------------------------------------------------------------------
// WMO weather code → human-readable condition
// https://open-meteo.com/en/docs#weathervariables
// ---------------------------------------------------------------------------

function wmoCondition(code: number): string {
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "foggy";
  if (code <= 55) return "drizzling";
  if (code <= 65) return "rainy";
  if (code <= 75) return "snowy";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  if (code <= 99) return "thunderstorms";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Task 2a — Fetch live weather from Open-Meteo (no API key required)
// ---------------------------------------------------------------------------

const fetchWeather = task(
  { name: "fetchWeather" },
  async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
    console.log(`[fetchWeather] Fetching weather for (${lat}, ${lng})`);

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      current: {
        temperature_2m: number;
        wind_speed_10m: number;
        relative_humidity_2m: number;
        weather_code: number;
      };
    };

    const current = data.current;
    const weather: WeatherData = {
      temperatureF: Math.round(current.temperature_2m),
      windSpeedMph: Math.round(current.wind_speed_10m),
      humidity: Math.round(current.relative_humidity_2m),
      condition: wmoCondition(current.weather_code),
    };

    console.log(
      `[fetchWeather] ${weather.condition}, ${weather.temperatureF}°F, ` +
        `wind ${weather.windSpeedMph}mph, humidity ${weather.humidity}%`,
    );

    return weather;
  },
);

// ---------------------------------------------------------------------------
// Task 2b — Generate geo-relevant headlines (parallel branch B)
// ---------------------------------------------------------------------------

const generateHeadlines = task(
  { name: "generateHeadlines" },
  async function generateHeadlines(ctx: LocationContext): Promise<string[]> {
    console.log(`[generateHeadlines] ${ctx.summary}`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a local news editor. Generate concise, relevant headlines for the described area.",
        },
        {
          role: "user",
          content:
            `Area: ${ctx.summary}\n` +
            `Key features: ${ctx.keyFeatures.join(", ")}\n\n` +
            "Generate 4 geo-relevant broadcast headlines for this area. " +
            'Return a JSON object with key "headlines" containing an array of strings.',
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");
    return (parsed.headlines as string[]) ?? [];
  },
);

// ---------------------------------------------------------------------------
// Task 2c — Profile the target audience (parallel branch C)
// ---------------------------------------------------------------------------

const assessAudience = task(
  { name: "assessAudience" },
  async function assessAudience(ctx: LocationContext): Promise<AudienceProfile> {
    console.log(`[assessAudience] ${ctx.summary}`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an audience strategist for a geo-targeted broadcast platform.",
        },
        {
          role: "user",
          content:
            `Area: ${ctx.summary}\n` +
            `Demographics: ${ctx.demographicNotes}\n\n` +
            "Return a JSON object with exactly these keys: " +
            '"primarySegment" (one phrase describing the core audience), ' +
            '"tone" (one word: e.g. conversational, authoritative, upbeat), ' +
            '"localConcerns" (array of 3-4 topics this audience cares most about).',
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");

    return {
      primarySegment: parsed.primarySegment ?? "",
      tone: parsed.tone ?? "conversational",
      localConcerns: parsed.localConcerns ?? [],
    };
  },
);

// ---------------------------------------------------------------------------
// Task 3 — Compose the broadcast script
// ---------------------------------------------------------------------------

const composeBroadcast = task(
  { name: "composeBroadcast" },
  async function composeBroadcast(
    ctx: LocationContext,
    headlines: string[],
    audience: AudienceProfile,
    weather: WeatherData,
  ): Promise<BroadcastDraft> {
    console.log(`[composeBroadcast] audience=${audience.primarySegment}, weather=${weather.condition}`);

    const weatherLine =
      `Current conditions: ${weather.condition}, ${weather.temperatureF}°F, ` +
      `wind ${weather.windSpeedMph}mph, humidity ${weather.humidity}%.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            `You are a broadcast writer for a geo-targeted local content platform. ` +
            `Write in a ${audience.tone} tone for ${audience.primarySegment}. ` +
            `Weave the live weather conditions naturally into the story — ` +
            `let them influence the mood, urgency, and advice in the script.`,
        },
        {
          role: "user",
          content:
            `Location: ${ctx.summary}\n` +
            `${weatherLine}\n` +
            `Headlines to cover: ${headlines.join(" | ")}\n` +
            `Audience concerns: ${audience.localConcerns.join(", ")}\n\n` +
            "Write a 3-paragraph broadcast script that weaves the headlines and live weather " +
            "into a coherent local story. The weather should feel integral, not bolted on. " +
            "Return a JSON object with: " +
            '"script" (the 3-paragraph text), ' +
            '"callToAction" (one closing sentence prompting the audience to act or stay informed), ' +
            '"estimatedReadTimeSecs" (integer).',
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");

    return {
      locationContext: ctx,
      audienceProfile: audience,
      weather,
      headlines,
      script: parsed.script ?? "",
      callToAction: parsed.callToAction ?? "",
      estimatedReadTimeSecs: parsed.estimatedReadTimeSecs ?? 60,
    };
  },
);

// ---------------------------------------------------------------------------
// Task 4 — Refine and polish the broadcast
// ---------------------------------------------------------------------------

const refineBroadcast = task(
  { name: "refineBroadcast" },
  async function refineBroadcast(draft: BroadcastDraft): Promise<string> {
    console.log(
      `[refineBroadcast] ~${draft.estimatedReadTimeSecs}s script, tightening...`,
    );

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a senior editor for a geocast platform. " +
            "Tighten the script for clarity and local resonance. Return only the final script as plain text — no JSON, no headings.",
        },
        {
          role: "user",
          content:
            `Target audience: ${draft.audienceProfile.primarySegment}\n` +
            `Location: ${draft.locationContext.summary}\n\n` +
            `Script:\n${draft.script}\n\n` +
            `Call to action: ${draft.callToAction}\n\n` +
            "Refine the script and append the call to action as the final sentence. Return only the polished text.",
        },
      ],
    });

    return response.choices[0].message.content ?? draft.script;
  },
);

// ---------------------------------------------------------------------------
// Orchestrating task — entry point for the full geocast pipeline
// analyzeLocation → [fetchWeather ∥ generateHeadlines ∥ assessAudience]
//   → composeBroadcast → refineBroadcast
// ---------------------------------------------------------------------------

task(
  { name: "orchestrateGeocast" },
  async function orchestrateGeocast(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<string> {
    console.log(`[orchestrateGeocast] Starting pipeline for (${lat}, ${lng})`);

    // Step 1 — understand the location
    const locationContext = await analyzeLocation(lat, lng, radiusKm);
    console.log(`[orchestrateGeocast] Location ready: ${locationContext.summary}`);

    // Step 2 — parallel: live weather + headlines + audience profile
    const [weather, headlines, audienceProfile] = await Promise.all([
      fetchWeather(lat, lng),
      generateHeadlines(locationContext),
      assessAudience(locationContext),
    ]);
    console.log(
      `[orchestrateGeocast] Weather: ${weather.condition} ${weather.temperatureF}°F | ` +
        `${headlines.length} headlines | audience: ${audienceProfile.primarySegment}`,
    );

    // Step 3 — compose the broadcast from all merged context
    const draft = await composeBroadcast(locationContext, headlines, audienceProfile, weather);
    console.log(`[orchestrateGeocast] Draft ready (~${draft.estimatedReadTimeSecs}s)`);

    // Step 4 — refine and return the final script
    const finalScript = await refineBroadcast(draft);
    console.log(`[orchestrateGeocast] Final script ready (${finalScript.length} chars)`);

    return finalScript;
  },
);
