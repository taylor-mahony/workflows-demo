# Geocast Workflow POC — Render Workflows (TypeScript)

This proof-of-concept demonstrates a chained agentic pipeline using Render Workflows and OpenAI. Each task is an LLM call whose output feeds the next, with a parallel fan-out step in the middle.

## Pipeline

```
orchestrateGeocast(lat, lng, radiusKm)
  └─ analyzeLocation            → LocationContext
       ├─ generateHeadlines     → string[]          ─┐
       └─ assessAudience        → AudienceProfile   ─┤ parallel
                                                      ↓
                                composeBroadcast   → BroadcastDraft
                                refineBroadcast    → string (final script)
```

## Tasks

### `analyzeLocation(lat, lng, radiusKm)` → `LocationContext`

Calls `gpt-4o-mini` to describe the geographic area at the given coordinates: a plain-text summary, key civic/geographic features, and a demographic note.

### `generateHeadlines(ctx: LocationContext)` → `string[]`

Calls `gpt-4o-mini` to produce 4 geo-relevant broadcast headlines for the area. Runs in parallel with `assessAudience`.

### `assessAudience(ctx: LocationContext)` → `AudienceProfile`

Calls `gpt-4o-mini` to profile the target audience: primary segment, preferred tone, and local concerns. Runs in parallel with `generateHeadlines`.

### `composeBroadcast(ctx, headlines, audience)` → `BroadcastDraft`

Receives the merged output of both parallel tasks and calls `gpt-4o-mini` to write a 3-paragraph broadcast script, a call to action, and an estimated read time.

### `refineBroadcast(draft: BroadcastDraft)` → `string`

Senior editor pass — tightens language, improves local resonance, appends the call to action. Returns the final polished script as plain text.

### `orchestrateGeocast(lat, lng, radiusKm)` → `string`

Top-level entry point. Chains the full pipeline and returns the final broadcast script.

## Local Development

### Prerequisites

- Node.js 18+
- [Render CLI](https://render.com/docs/cli) 2.11.0+
- An OpenAI API key

### Setup

```bash
cp .env.example .env
# Fill in OPENAI_API_KEY in .env
npm install
```

### Run the local task server

```bash
render workflows dev -- npm start
```

### Trigger tasks from a second terminal

Run the full geocast pipeline (San Francisco, 10km radius):

```bash
render workflows tasks start orchestrateGeocast --local --input='[37.7749, -122.4194, 10]'
```

Run individual tasks for testing:

```bash
# Analyze a location
render workflows tasks start analyzeLocation --local --input='[37.7749, -122.4194, 10]'

# Generate headlines for a location context (pass a LocationContext JSON object)
render workflows tasks start generateHeadlines --local --input='[{"lat":37.7749,"lng":-122.4194,"radiusKm":10,"summary":"San Francisco, CA","keyFeatures":["Golden Gate Bridge","tech industry","diverse neighborhoods"],"demographicNotes":"Young, urban, tech-savvy population."}]'

# Assess audience for a location context
render workflows tasks start assessAudience --local --input='[{"lat":37.7749,"lng":-122.4194,"radiusKm":10,"summary":"San Francisco, CA","keyFeatures":["Golden Gate Bridge"],"demographicNotes":"Young, urban, tech-savvy population."}]'
```

## Deploying to Render

| Option | Value |
| --- | --- |
| Build command | `npm install` |
| Start command | `npm start` |

Add `OPENAI_API_KEY` as an environment variable in the Render Dashboard before deploying.

## Key Concepts

### Chained agents

Each task calls `gpt-4o-mini` and returns a plain JSON-serializable object that the next task receives as its input. No shared state — all context flows explicitly through task arguments.

### Parallel fan-out

`orchestrateGeocast` uses `Promise.all` to run `generateHeadlines` and `assessAudience` concurrently after `analyzeLocation` completes. Render spins up a separate instance for each, so they execute in true parallel.

### JSON-serializable types

All inter-task types (`LocationContext`, `AudienceProfile`, `BroadcastDraft`) are plain objects with primitive fields. The SDK requires all arguments and return values to be JSON-serializable.

## Resources

- [Render Workflows documentation](https://render.com/docs/workflows)
- [Workflows tutorial](https://render.com/docs/workflows-tutorial)
- [Local development guide](https://render.com/docs/workflows-local-development)
