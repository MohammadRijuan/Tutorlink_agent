# Design System — TutorLink AI Marketing Manager

## Direction
A distinctive editorial operations console, not a generic AI gradient dashboard. Visual language: ink-dark navigation, warm paper canvas, vivid vermilion accents, restrained lime status signals, fine grid lines, compact data typography, and generous whitespace. Avoid purple-blue AI gradients, glassmorphism, oversized rounded cards everywhere, and generic robot illustrations.

## Typography
- Display: `Space Grotesk` or a bundled/local equivalent for strong editorial headings.
- Body/UI: `DM Sans`.
- Data/technical labels: `IBM Plex Mono`.
- Bangla fallback: system fonts with strong Bengali glyph coverage; verify actual rendering on Windows/Linux before shipping.
- Use `next/font` where appropriate and verify production font files load correctly. Avoid relying on remote fonts at runtime if offline/local deployment matters.

## Color tokens
- `--canvas`: #F4F1E8 (warm paper)
- `--surface`: #FFFEFA
- `--ink`: #171916
- `--muted`: #666B62
- `--line`: #D9D8CF
- `--accent`: #E84B2C (vermilion)
- `--signal`: #B9E769 (lime)
- `--danger`: #B42318
- `--night`: #20241F
Use semantic tokens, check contrast, and do not rely on color alone for status.

## Layout
- Desktop: fixed-width narrow navigation rail + flexible workspace; top bar shows Page connection, automation state, and emergency pause.
- Mobile: collapsible navigation, stacked metric panels, tables become cards, all actions remain accessible.
- Dashboard should surface qualified leads first; reach and engagement are secondary.
- Prefer data-dense editorial layouts and chart annotations over decorative cards.
- Show the reason behind each autonomous decision and link it to source metrics.

## Key screens
1. Overview: qualified leads, booked tuition, attribution confidence, next scheduled action, automation health.
2. Page Analyzer: Page identity, accessible historical data, top/weak content, missing permissions.
3. Strategy Lab: goal, audience hypotheses, experiments, rationale, confidence.
4. Content Studio: Bangla copy, preview, hashtags, brand assets, and a rendered Reel MP4 on publish.
5. Calendar: AI-selected cadence and publish queue; explain why schedule changed.
6. Leads: qualification state, service area, class/subject needs, outcome, source attribution.
7. Learning Log: hypothesis, test, observation window, outcome, next action.
8. Integrations: Meta connection status, permissions, model provider, scheduler health.
9. Settings: business facts, content guardrails, frequency limits, pause switch.

## Interaction rules
- All actions need loading, success, empty, and error states.
- Use confirmation for disconnecting integrations or destructive actions.
- Emergency pause must be obvious, keyboard accessible, and persistent.
- Content Studio shows persistent job status, attempt count, next retry, safe failure category, and eligible manual retry; progress must survive leaving the page.
- Explain missing data rather than showing fabricated zero values.
- Charts must include time range and metric definition.
- Use shadcn/ui as accessible primitives, then customize layout and styling.


## Required contact and conversion design
- All generated post/banner/image/Reel/video previews must include the exact number **01886-603858** as a visible, legible brand element. For video/Reels, preview the brief on-screen display/end card and ensure it lasts long enough to read.
- Post previews must show a clear **Send Message** CTA/button/link that opens the configured TutorLink Facebook Page Messenger conversation. Use a native platform CTA when supported; otherwise use the verified configured Messenger URL.
- The Content Studio must expose validation status for phone-number presence/readability and Messenger URL/CTA validity. Failed checks must be prominent and prevent publishing.
- Use high contrast and safe margins; do not obscure subtitles, faces, key offer details, or platform controls.

## Agent Mode Toggle and Human-Control State

Place a prominent Agent Mode switch in the main dashboard/header and make it accessible from the automation settings. Show clear states: **Agent Mode ON — Automation active** and **Agent Mode OFF — Human control**. Turning it OFF should require at most a concise confirmation if jobs are currently running, and immediately display the human-control state after the backend confirms it. Show any in-flight task that could not be interrupted. Keep manual draft editing and human publishing workflows available while automation is off. Turning it back on requires an explicit user action.


## Live publishing UI behavior
- The primary Content Studio action runs the agent's publish-or-wait campaign; it does not require the owner to choose a topic or format. Optional guidance is persisted for future decisions.
- A successful response must show the returned Meta post/video ID. A wait/skip response must show the reason. An ambiguous failure must not imply the content was published.
- The graphic carries a visible Messenger CTA and phone number; the caption contains the verified clickable Messenger URL. Do not display this as a native Facebook CTA button unless Meta confirms one was created.
