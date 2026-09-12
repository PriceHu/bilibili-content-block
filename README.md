# BiliBili Content Block

A userscript that blurs BiliBili content matching configurable title and author regular expressions.

Created by GPT 5.6 Luna and Terra.

## Features

- Blur matching video and post titles.
- Blur matching thumbnails and media previews.
- Block content by author name.
- Allow selected authors to override title and blocked-author rules.
- Re-scan dynamically loaded BiliBili content.
- Manage rules from the in-page settings panel.
- Choose the settings button side, vertical position, and light or dark theme.
- Temporarily reveal blurred media by hovering over it.

## Installation

1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. [Click to install BiliBili Content Block](https://raw.githubusercontent.com/PriceHu/bilibili-content-block/main/bilibili-content-block.user.js) or open `bilibili-content-block.user.js` in the userscript manager.
3. Install or enable the script.
4. Open a supported BiliBili page and use the vertical **CONTENT BLOCKER** button to configure rules.

The script runs on BiliBili HTTP and HTTPS pages, excluding mobile, API, live, mall, message, and BBQ pages.

## Configuration

The settings panel provides three matching lists and a selector list:

- **Title Patterns**: regular expressions matched against video and post text.
- **Blocked Authors**: regular expressions matched against author names.
- **Allowed Authors**: regular expressions that override other matches for the same content.
- **Content Selectors**: CSS selectors for the card, title, media, and author elements used by the scanner.

Pattern entries can be enabled or disabled, edited, filtered, reordered by dragging, or removed. New pattern entries are validated as JavaScript regular expressions before they are saved. Matching is case-insensitive and Unicode-aware. Selector rules can be enabled, edited, added, or removed.

Selector rules are stored in the same userscript configuration. If BiliBili changes its markup, update the affected CSS selectors in **Content Selectors** instead of modifying or reinstalling the script. The card selector is required; title, media, and author selectors may be left empty when that content is unavailable.

Configuration is saved by the userscript manager under the key `bilibili-content-blur:v2`.

## Notes

- Blurred media is revealed while hovered.
- Invalid regular expressions are marked in the settings panel and reported in the browser console.
- Invalid CSS selectors are marked in the settings panel and skipped during scanning until corrected.
