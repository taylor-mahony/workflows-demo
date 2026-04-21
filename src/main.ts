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

type BroadcastDraft = {
  locationContext: LocationContext;
  audienceProfile: AudienceProfile;
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
// Task 2a — Generate geo-relevant headlines (parallel branch A)
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
// Task 2b — Profile the target audience (parallel branch B)
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
  ): Promise<BroadcastDraft> {
    console.log(`[composeBroadcast] audience=${audience.primarySegment}`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            `You are a broadcast writer for a geo-targeted local content platform. ` +
            `Write in a ${audience.tone} tone for ${audience.primarySegment}.`,
        },
        {
          role: "user",
          content:
            `Location: ${ctx.summary}\n` +
            `Headlines to cover: ${headlines.join(" | ")}\n` +
            `Audience concerns: ${audience.localConcerns.join(", ")}\n\n` +
            "Write a 3-paragraph broadcast script that weaves the headlines into a coherent local story. " +
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
// analyzeLocation → [generateHeadlines ∥ assessAudience] → composeBroadcast → refineBroadcast
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

    // Step 2 — parallel: generate headlines and profile the audience
    const [headlines, audienceProfile] = await Promise.all([
      generateHeadlines(locationContext),
      assessAudience(locationContext),
    ]);
    console.log(
      `[orchestrateGeocast] ${headlines.length} headlines, audience: ${audienceProfile.primarySegment}`,
    );

    // Step 3 — compose the broadcast from merged context
    const draft = await composeBroadcast(locationContext, headlines, audienceProfile);
    console.log(`[orchestrateGeocast] Draft ready (~${draft.estimatedReadTimeSecs}s)`);

    // Step 4 — refine and return the final script
    const finalScript = await refineBroadcast(draft);
    console.log(`[orchestrateGeocast] Final script ready (${finalScript.length} chars)`);

    return finalScript;
  },
);
