#!/usr/bin/env node
/**
 * git-graph — serves a commit graph for the repo you run it in.
 *
 *   node git-graph.mjs            # current directory
 *   node git-graph.mjs ../other   # another repo
 *   node git-graph.mjs --port 8080
 *
 * Binds to 127.0.0.1 only. Runs a fixed set of read-only git commands
 * (rev-parse, remote get-url, log) plus `git fetch --prune` when you press
 * the button. Never writes to the repo, never takes shell input from the page.
 */

import http from "node:http";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PORT = Number(flag("--port", 7345));
const COUNT = Number(flag("--count", 300));
const DEFAULT_TARGET = flag("--target", "origin/uat");

// the first bare argument is the repo path; flag values are not bare arguments
const taken = new Set();
argv.forEach((a, i) => {
  if (a.startsWith("--")) {
    taken.add(i);
    if (argv[i + 1] && !argv[i + 1].startsWith("--")) taken.add(i + 1);
  }
});
const bare = argv.filter((a, i) => !taken.has(i));
const cwd = path.resolve(bare[0] || ".");
const extraPaths = bare.slice(1);

const HTML = "<title>Commit graph</title>\n\n<style>\n  *,\n  *::before,\n  *::after {\n    box-sizing: border-box;\n  }\n\n  :root {\n    --mono: ui-monospace, \"JetBrains Mono\", \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace;\n    --sans: system-ui, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif;\n\n    --paper: #eef0ec;\n    --surface: #fbfcfa;\n    --sunk: #e4e7e1;\n    --ink: #171a16;\n    --ink-2: #4d534b;\n    --ink-3: #838b7f;\n    --rule: #d3d8ce;\n    --rule-soft: #e2e6df;\n    --focus: #2f6fd0;\n    --head: #1f6f4f;\n    --tag: #8a6420;\n    --remote: #4d534b;\n\n    --l0: #3b7dd8;\n    --l1: #e07b39;\n    --l2: #2f9e6f;\n    --l3: #a45cd8;\n    --l4: #d84f6a;\n    --l5: #12a0ad;\n    --l6: #9b8b2f;\n    --l7: #d1568f;\n\n    --pitch: 38px;\n    --gutter: 80px;\n  }\n\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --paper: #121513;\n      --surface: #1a1e1b;\n      --sunk: #0d100e;\n      --ink: #e7ebe5;\n      --ink-2: #a7afa3;\n      --ink-3: #767e73;\n      --rule: #2b312c;\n      --rule-soft: #21261f;\n      --focus: #6ea3f0;\n      --head: #5fc79a;\n      --tag: #d0a54f;\n      --remote: #a7afa3;\n\n      --l0: #6ea3f0;\n      --l1: #f09a5c;\n      --l2: #56c393;\n      --l3: #bd85e8;\n      --l4: #f0798e;\n      --l5: #3ec2ce;\n      --l6: #c1b055;\n      --l7: #ea7fac;\n    }\n  }\n\n  :root[data-theme=\"light\"] {\n    --paper: #eef0ec;\n    --surface: #fbfcfa;\n    --sunk: #e4e7e1;\n    --ink: #171a16;\n    --ink-2: #4d534b;\n    --ink-3: #838b7f;\n    --rule: #d3d8ce;\n    --rule-soft: #e2e6df;\n    --focus: #2f6fd0;\n    --head: #1f6f4f;\n    --tag: #8a6420;\n    --remote: #4d534b;\n    --l0: #3b7dd8;\n    --l1: #e07b39;\n    --l2: #2f9e6f;\n    --l3: #a45cd8;\n    --l4: #d84f6a;\n    --l5: #12a0ad;\n    --l6: #9b8b2f;\n    --l7: #d1568f;\n  }\n\n  :root[data-theme=\"dark\"] {\n    --paper: #121513;\n    --surface: #1a1e1b;\n    --sunk: #0d100e;\n    --ink: #e7ebe5;\n    --ink-2: #a7afa3;\n    --ink-3: #767e73;\n    --rule: #2b312c;\n    --rule-soft: #21261f;\n    --focus: #6ea3f0;\n    --head: #5fc79a;\n    --tag: #d0a54f;\n    --remote: #a7afa3;\n    --l0: #6ea3f0;\n    --l1: #f09a5c;\n    --l2: #56c393;\n    --l3: #bd85e8;\n    --l4: #f0798e;\n    --l5: #3ec2ce;\n    --l6: #c1b055;\n    --l7: #ea7fac;\n  }\n\n  body {\n    background: var(--paper);\n    color: var(--ink);\n    font-family: var(--sans);\n    font-size: 14px;\n    line-height: 1.45;\n    -webkit-font-smoothing: antialiased;\n  }\n\n  .shell {\n    max-width: 1080px;\n    margin: 0 auto;\n    padding: 28px 20px 64px;\n    display: flex;\n    flex-direction: column;\n    gap: 18px;\n  }\n\n  /* ---- masthead ---- */\n\n  .masthead {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: baseline;\n    gap: 8px 18px;\n    border-bottom: 1px solid var(--rule);\n    padding-bottom: 14px;\n  }\n\n  #repoPick {\n    font-family: var(--mono);\n    font-size: 13px;\n    font-weight: 600;\n    letter-spacing: 0.02em;\n    color: var(--ink);\n    background: var(--surface);\n    border: 1px solid var(--rule);\n    border-radius: 3px;\n    padding: 4px 8px;\n    max-width: 260px;\n  }\n\n  #repoPick:hover {\n    border-color: var(--ink-3);\n  }\n\n  .masthead h1 {\n    font-family: var(--mono);\n    font-size: 15px;\n    font-weight: 600;\n    letter-spacing: 0.06em;\n    text-transform: uppercase;\n    margin-right: auto;\n  }\n\n  .stat {\n    font-family: var(--mono);\n    font-size: 11px;\n    color: var(--ink-3);\n    letter-spacing: 0.04em;\n    font-variant-numeric: tabular-nums;\n  }\n\n  .stat b {\n    color: var(--ink-2);\n    font-weight: 500;\n  }\n\n  /* ---- controls ---- */\n\n  .toolbar {\n    position: sticky;\n    top: 0;\n    z-index: 4;\n    background: var(--paper);\n    padding: 10px 0;\n    border-bottom: 1px solid var(--rule-soft);\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    gap: 8px;\n  }\n\n  input[type=\"search\"],\n  input[type=\"text\"],\n  textarea {\n    font-family: var(--mono);\n    font-size: 12px;\n    color: var(--ink);\n    background: var(--surface);\n    border: 1px solid var(--rule);\n    border-radius: 3px;\n    padding: 6px 9px;\n  }\n\n  input[type=\"search\"] {\n    flex: 1 1 200px;\n    min-width: 0;\n  }\n\n  input::placeholder,\n  textarea::placeholder {\n    color: var(--ink-3);\n  }\n\n  button {\n    font-family: var(--mono);\n    font-size: 11px;\n    letter-spacing: 0.05em;\n    color: var(--ink-2);\n    background: var(--surface);\n    border: 1px solid var(--rule);\n    border-radius: 3px;\n    padding: 6px 10px;\n    cursor: pointer;\n    text-transform: uppercase;\n  }\n\n  button:hover {\n    color: var(--ink);\n    border-color: var(--ink-3);\n  }\n\n  button[aria-pressed=\"true\"] {\n    background: var(--sunk);\n    color: var(--ink);\n  }\n\n  .chip-author {\n    display: inline-flex;\n    align-items: center;\n    gap: 6px;\n    text-transform: none;\n    letter-spacing: 0;\n    font-size: 12px;\n  }\n\n  .chip-author i {\n    width: 7px;\n    height: 7px;\n    border-radius: 50%;\n    background: currentColor;\n    opacity: 0.55;\n  }\n\n  .chip-author[aria-pressed=\"false\"] {\n    color: var(--ink-3);\n    text-decoration: line-through;\n  }\n\n  :focus-visible {\n    outline: 2px solid var(--focus);\n    outline-offset: 2px;\n  }\n\n  /* ---- loader panel ---- */\n\n  .loader {\n    background: var(--surface);\n    border: 1px solid var(--rule);\n    border-radius: 4px;\n    padding: 14px;\n    display: none;\n    flex-direction: column;\n    gap: 10px;\n  }\n\n  .loader[data-open=\"true\"] {\n    display: flex;\n  }\n\n  .loader p {\n    font-size: 12.5px;\n    color: var(--ink-2);\n    max-width: 66ch;\n  }\n\n  .steps {\n    list-style: none;\n    display: flex;\n    flex-direction: column;\n    gap: 14px;\n  }\n\n  .steps li {\n    display: flex;\n    gap: 10px;\n    align-items: flex-start;\n  }\n\n  .steps li > div {\n    display: flex;\n    flex-direction: column;\n    gap: 7px;\n    flex: 1;\n    min-width: 0;\n  }\n\n  .step-n {\n    font-family: var(--mono);\n    font-size: 10px;\n    font-weight: 600;\n    line-height: 17px;\n    width: 17px;\n    height: 17px;\n    text-align: center;\n    border-radius: 50%;\n    border: 1px solid var(--rule);\n    color: var(--ink-3);\n    flex: none;\n    margin-top: 1px;\n  }\n\n  button.primary {\n    background: var(--ink);\n    color: var(--paper);\n    border-color: var(--ink);\n  }\n\n  button.primary:hover {\n    background: var(--ink-2);\n    border-color: var(--ink-2);\n    color: var(--paper);\n  }\n\n  .hint {\n    font-family: var(--mono);\n    font-size: 11px;\n    color: var(--ink-3);\n  }\n\n  .hint[data-tone=\"bad\"] {\n    color: var(--l4);\n  }\n\n  /* the one control that writes to the repo — it never wears a status colour */\n  button.sync {\n    border-color: var(--ink-3);\n    color: var(--ink);\n  }\n\n  button.sync:disabled {\n    color: var(--ink-3);\n    border-color: var(--rule);\n    cursor: default;\n  }\n\n  button.sync:disabled:hover {\n    color: var(--ink-3);\n    border-color: var(--rule);\n  }\n\n  button.sync b {\n    font-weight: 600;\n    font-variant-numeric: tabular-nums;\n  }\n\n  .loader[data-drop=\"true\"] {\n    border-color: var(--focus);\n    border-style: dashed;\n  }\n\n  .cmd {\n    display: flex;\n    align-items: stretch;\n    gap: 0;\n    border: 1px solid var(--rule);\n    border-radius: 3px;\n    overflow: hidden;\n  }\n\n  .cmd code {\n    font-family: var(--mono);\n    font-size: 11.5px;\n    padding: 8px 10px;\n    background: var(--sunk);\n    color: var(--ink);\n    overflow-x: auto;\n    white-space: nowrap;\n    flex: 1;\n  }\n\n  .cmd button {\n    border: 0;\n    border-left: 1px solid var(--rule);\n    border-radius: 0;\n  }\n\n  .loader textarea {\n    width: 100%;\n    min-height: 110px;\n    resize: vertical;\n  }\n\n  .loader-row {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 8px;\n    align-items: center;\n  }\n\n  .saved {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 6px;\n    align-items: center;\n  }\n\n  .saved .label {\n    font-family: var(--mono);\n    font-size: 10.5px;\n    letter-spacing: 0.08em;\n    text-transform: uppercase;\n    color: var(--ink-3);\n  }\n\n  .saved button span {\n    color: var(--ink-3);\n    margin-left: 6px;\n  }\n\n  /* ---- graph ---- */\n\n  .graphwrap {\n    position: relative;\n    background: var(--surface);\n    border: 1px solid var(--rule);\n    border-radius: 4px;\n    overflow: hidden;\n  }\n\n  #rails {\n    position: absolute;\n    top: 0;\n    left: 0;\n    pointer-events: none;\n  }\n\n  #rows {\n    padding-left: var(--gutter);\n  }\n\n  .row {\n    height: var(--pitch);\n    display: grid;\n    grid-template-columns: minmax(0, 1fr) 120px 84px 68px;\n    align-items: center;\n    gap: 12px;\n    padding-right: 12px;\n    border-top: 1px solid var(--rule-soft);\n    cursor: pointer;\n    transition: opacity 0.12s ease, background-color 0.12s ease;\n  }\n\n  .row:first-child {\n    border-top: 0;\n  }\n\n  .row:hover {\n    background: var(--sunk);\n  }\n\n  .row[data-sel=\"true\"] {\n    background: var(--sunk);\n  }\n\n  .row[data-dim=\"true\"] {\n    opacity: 0.24;\n  }\n\n  .subject {\n    display: flex;\n    align-items: center;\n    gap: 7px;\n    min-width: 0;\n  }\n\n  .msg {\n    min-width: 0;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  .msg em {\n    font-style: normal;\n    color: var(--ink-3);\n  }\n\n  .refs {\n    display: flex;\n    align-items: center;\n    gap: 5px;\n    margin-left: auto;\n    padding-left: 10px;\n    flex: none;\n  }\n\n  .ref {\n    display: inline-flex;\n    align-items: center;\n    gap: 4px;\n    font-family: var(--mono);\n    font-size: 10px;\n    letter-spacing: 0.03em;\n    padding: 2px 6px 2px 5px;\n    border-radius: 9px;\n    border: 1px solid currentColor;\n    white-space: nowrap;\n  }\n\n  .ref svg {\n    width: 9px;\n    height: 9px;\n    flex: none;\n  }\n\n  .ref[data-kind=\"head\"] {\n    color: var(--surface);\n    background: var(--head);\n    border-color: var(--head);\n    font-weight: 600;\n  }\n\n  .ref[data-kind=\"tag\"] {\n    color: var(--tag);\n    border-style: dashed;\n  }\n\n  .ref[data-kind=\"remote\"] {\n    color: var(--remote);\n  }\n\n  .ref[data-kind=\"local\"] {\n    color: var(--focus);\n  }\n\n  .who,\n  .when,\n  .sha {\n    font-family: var(--mono);\n    font-size: 11px;\n    color: var(--ink-3);\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    font-variant-numeric: tabular-nums;\n  }\n\n  .when {\n    text-align: right;\n  }\n\n  .sha {\n    text-align: right;\n    color: var(--ink-2);\n  }\n\n  .legend {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 6px 20px;\n    font-family: var(--mono);\n    font-size: 10.5px;\n    letter-spacing: 0.05em;\n    text-transform: uppercase;\n    color: var(--ink-3);\n  }\n\n  .legend span {\n    display: inline-flex;\n    align-items: center;\n    gap: 7px;\n  }\n\n  /* ---- folder picker ---- */\n\n  .scrim {\n    position: fixed;\n    inset: 0;\n    z-index: 30;\n    background: rgba(10, 12, 10, 0.42);\n    display: none;\n    align-items: center;\n    justify-content: center;\n    padding: 24px;\n  }\n\n  .scrim[data-open=\"true\"] {\n    display: flex;\n  }\n\n  .picker {\n    width: min(560px, 100%);\n    max-height: min(560px, 80vh);\n    background: var(--surface);\n    border: 1px solid var(--rule);\n    border-radius: 5px;\n    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);\n    display: flex;\n    flex-direction: column;\n    overflow: hidden;\n  }\n\n  .picker-head {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    padding: 10px 12px;\n    border-bottom: 1px solid var(--rule-soft);\n  }\n\n  .picker-head button {\n    padding: 3px 9px;\n    line-height: 1.2;\n  }\n\n  .picker-path {\n    font-family: var(--mono);\n    font-size: 11.5px;\n    color: var(--ink-2);\n    direction: rtl;\n    text-align: left;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    flex: 1;\n  }\n\n  .picker-list {\n    overflow-y: auto;\n    flex: 1;\n    padding: 4px 0;\n  }\n\n  .picker-row {\n    width: 100%;\n    display: flex;\n    align-items: center;\n    gap: 9px;\n    padding: 7px 12px;\n    background: none;\n    border: 0;\n    border-radius: 0;\n    text-transform: none;\n    letter-spacing: 0;\n    font-family: var(--sans);\n    font-size: 13px;\n    color: var(--ink);\n    text-align: left;\n    cursor: pointer;\n  }\n\n  .picker-row:hover {\n    background: var(--sunk);\n    border-color: transparent;\n  }\n\n  .picker-row svg {\n    width: 13px;\n    height: 13px;\n    flex: none;\n    color: var(--ink-3);\n  }\n\n  .picker-row[data-repo=\"true\"] svg {\n    color: var(--l2);\n  }\n\n  .picker-row .badge {\n    margin-left: auto;\n    font-family: var(--mono);\n    font-size: 9.5px;\n    letter-spacing: 0.06em;\n    text-transform: uppercase;\n    color: var(--l2);\n    border: 1px solid currentColor;\n    border-radius: 9px;\n    padding: 1px 6px;\n  }\n\n  .picker-foot {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    padding: 10px 12px;\n    border-top: 1px solid var(--rule-soft);\n  }\n\n  .picker-foot .hint {\n    flex: 1;\n    min-width: 0;\n  }\n\n  .picker-empty {\n    padding: 22px 14px;\n    font-family: var(--mono);\n    font-size: 11.5px;\n    color: var(--ink-3);\n    text-align: center;\n  }\n\n  /* ---- hover card ---- */\n\n  .card {\n    position: fixed;\n    z-index: 20;\n    width: min(440px, calc(100vw - 32px));\n    background: var(--surface);\n    border: 1px solid var(--rule);\n    border-radius: 5px;\n    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.16);\n    padding: 12px 14px;\n    display: none;\n    flex-direction: column;\n    gap: 9px;\n  }\n\n  .card[data-open=\"true\"] {\n    display: flex;\n  }\n\n  .card-who {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    font-family: var(--mono);\n    font-size: 11px;\n    color: var(--ink-3);\n  }\n\n  .avatar {\n    width: 20px;\n    height: 20px;\n    border-radius: 50%;\n    display: grid;\n    place-items: center;\n    font-size: 9.5px;\n    font-weight: 600;\n    letter-spacing: 0.02em;\n    color: var(--surface);\n    flex: none;\n  }\n\n  .card-who b {\n    color: var(--ink);\n    font-weight: 600;\n  }\n\n  .card-subject {\n    font-size: 13.5px;\n    line-height: 1.4;\n    text-wrap: balance;\n  }\n\n  .card-body {\n    font-size: 12.5px;\n    line-height: 1.55;\n    color: var(--ink-2);\n    white-space: pre-wrap;\n    max-height: 190px;\n    overflow-y: auto;\n    border-left: 2px solid var(--rule);\n    padding-left: 10px;\n  }\n\n  .card-stat {\n    font-family: var(--mono);\n    font-size: 11px;\n    color: var(--ink-3);\n    font-variant-numeric: tabular-nums;\n    display: flex;\n    gap: 10px;\n  }\n\n  .card-stat .add {\n    color: var(--l2);\n  }\n\n  .card-stat .del {\n    color: var(--l4);\n  }\n\n  .card-foot {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    border-top: 1px solid var(--rule-soft);\n    padding-top: 9px;\n  }\n\n  .card-foot button,\n  .card-foot a {\n    font-family: var(--mono);\n    font-size: 11px;\n    letter-spacing: 0.03em;\n    text-transform: none;\n    display: inline-flex;\n    align-items: center;\n    gap: 5px;\n    color: var(--ink-2);\n    text-decoration: none;\n    background: var(--surface);\n    border: 1px solid var(--rule);\n    border-radius: 3px;\n    padding: 4px 8px;\n  }\n\n  .card-foot a:hover,\n  .card-foot button:hover {\n    color: var(--ink);\n    border-color: var(--ink-3);\n  }\n\n  .card-foot svg {\n    width: 11px;\n    height: 11px;\n  }\n\n  .empty {\n    padding: 40px 20px;\n    text-align: center;\n    color: var(--ink-3);\n    font-family: var(--mono);\n    font-size: 12px;\n  }\n\n  @media (max-width: 720px) {\n    .row {\n      grid-template-columns: minmax(0, 1fr) 72px;\n    }\n    .who,\n    .when {\n      display: none;\n    }\n  }\n\n  @media (prefers-reduced-motion: reduce) {\n    * {\n      transition: none !important;\n    }\n  }\n</style>\n\n<div class=\"shell\">\n  <header class=\"masthead\">\n    <select id=\"repoPick\" hidden aria-label=\"Repository\"></select>\n    <h1 id=\"title\">Commit graph</h1>\n    <span class=\"stat\" id=\"statCommits\"></span>\n    <span class=\"stat\" id=\"statSpan\"></span>\n    <button id=\"toggleLoader\" aria-expanded=\"false\">Load history</button>\n  </header>\n\n  <section class=\"loader\" id=\"loader\" data-open=\"false\">\n    <ol class=\"steps\">\n      <li>\n        <span class=\"step-n\">1</span>\n        <div>\n          <p>Run this in any repo &mdash; it copies the history straight to your clipboard.</p>\n          <div class=\"cmd\">\n            <code id=\"cmdText\"></code>\n            <button id=\"copyCmd\">Copy</button>\n          </div>\n        </div>\n      </li>\n      <li>\n        <span class=\"step-n\">2</span>\n        <div>\n          <p>Come back and hit the button. Nothing leaves this page &mdash; history is stored in your browser only.</p>\n          <div class=\"loader-row\">\n            <button id=\"fromClipboard\" class=\"primary\">Read clipboard &amp; draw</button>\n            <span class=\"hint\" id=\"loadHint\">or paste / drop the output below</span>\n          </div>\n        </div>\n      </li>\n    </ol>\n\n    <textarea id=\"paste\" spellcheck=\"false\" placeholder=\"Paste here and it draws itself\"></textarea>\n    <div class=\"loader-row\">\n      <input type=\"text\" id=\"projName\" placeholder=\"Name (defaults to the checked-out branch)\" style=\"flex: 1 1 220px\" />\n      <button id=\"render\">Draw graph</button>\n    </div>\n    <div class=\"saved\" id=\"saved\"></div>\n  </section>\n\n  <div class=\"toolbar\">\n    <input type=\"search\" id=\"search\" placeholder=\"Filter by message, author, hash or ref\" />\n    <button id=\"refresh\" hidden>Fetch &amp; refresh</button>\n    <button id=\"auto\" aria-pressed=\"false\" hidden>Auto</button>\n    <button id=\"sync\" class=\"sync\" hidden></button>\n    <button id=\"push\" class=\"sync\" hidden></button>\n    <span class=\"hint\" id=\"liveHint\" hidden></span>\n    <div class=\"saved\" id=\"authors\"></div>\n  </div>\n\n  <div class=\"graphwrap\">\n    <svg id=\"rails\" aria-hidden=\"true\"></svg>\n    <div id=\"rows\"></div>\n  </div>\n\n  <div class=\"legend\">\n    <span><svg width=\"14\" height=\"14\"><circle cx=\"7\" cy=\"7\" r=\"4\" fill=\"var(--l0)\"></circle></svg> commit</span>\n    <span\n      ><svg width=\"14\" height=\"14\">\n        <circle cx=\"7\" cy=\"7\" r=\"4\" fill=\"var(--surface)\" stroke=\"var(--l0)\" stroke-width=\"2\"></circle></svg\n      > merge</span\n    >\n    <span\n      ><svg width=\"14\" height=\"14\">\n        <rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" fill=\"var(--l0)\"></rect></svg\n      > root</span\n    >\n    <span>Hover for detail &middot; click to trace ancestry &middot; Esc clears</span>\n  </div>\n</div>\n\n<div class=\"scrim\" id=\"scrim\" data-open=\"false\">\n  <div class=\"picker\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Choose a repository\">\n    <div class=\"picker-head\">\n      <button id=\"pickUp\" title=\"Parent folder\">↑</button>\n      <span class=\"picker-path\" id=\"pickPath\"></span>\n    </div>\n    <div class=\"picker-list\" id=\"pickList\"></div>\n    <div class=\"picker-foot\">\n      <span class=\"hint\" id=\"pickHint\">Folders with a git repo are listed first — click one to add it.</span>\n      <button id=\"pickAdd\" disabled>Add this folder</button>\n      <button id=\"pickCancel\">Cancel</button>\n    </div>\n  </div>\n</div>\n\n<div class=\"card\" id=\"card\" data-open=\"false\">\n  <div class=\"card-who\"><span class=\"avatar\" id=\"cardAvatar\"></span><b id=\"cardAuthor\"></b><span id=\"cardWhen\"></span></div>\n  <div class=\"card-subject\" id=\"cardSubject\"></div>\n  <div class=\"card-body\" id=\"cardBody\"></div>\n  <div class=\"card-stat\" id=\"cardStat\"></div>\n  <div class=\"card-foot\">\n    <button id=\"cardHash\"></button>\n    <a id=\"cardLink\" target=\"_blank\" rel=\"noreferrer noopener\"></a>\n  </div>\n</div>\n\n<script>\n  (function () {\n    const SEED = ``;\n    const SEED_NAME = \"\";\n    const STORE = \"commit-graph.projects.v1\";\n    const LANES = 8;\n    const PITCH = 38;\n    const LANE_W = 16;\n    const PAD_X = 16;\n\n    const GLYPH = {\n      branch:\n        '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\"><line x1=\"6\" y1=\"3\" x2=\"6\" y2=\"15\"/><circle cx=\"18\" cy=\"6\" r=\"3\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/><path d=\"M18 9a9 9 0 0 1-9 9\"/></svg>',\n      tag: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12.6 2.7 21 11a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.7 12.6A2 2 0 0 1 2 11V4a2 2 0 0 1 2-2h7a2 2 0 0 1 1.6.7Z\"/><circle cx=\"7\" cy=\"7\" r=\"1.2\" fill=\"currentColor\"/></svg>',\n      copy: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"9\" y=\"9\" width=\"12\" height=\"12\" rx=\"2\"/><path d=\"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\"/></svg>',\n      external:\n        '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/><path d=\"M15 3h6v6\"/><path d=\"M10 14 21 3\"/></svg>',\n    };\n\n    const $ = (id) => document.getElementById(id);\n    const rowsEl = $(\"rows\");\n    const rails = $(\"rails\");\n    const NS = \"http://www.w3.org/2000/svg\";\n\n    let commits = [];\n    let byHash = new Map();\n    let mutedAuthors = new Set();\n    let authorColor = new Map();\n    let selected = null;\n    let repoBase = \"\";\n    let remoteOverride = \"\";\n\n    /* ---------- parsing ---------- */\n\n    const MARK = \"@@@\";\n    const STAT =\n      /^\\s*(\\d+) files? changed(?:,\\s*(\\d+) insertions?\\(\\+\\))?(?:,\\s*(\\d+) deletions?\\(-\\))?\\s*$/;\n\n    function record(line) {\n      const p = line.split(\"|\");\n      if (p.length < 7) return null;\n      const [full, short, parents, author, iso, refs] = p;\n      if (!/^[0-9a-f]{7,40}$/i.test(full.trim())) return null;\n      return {\n        full: full.trim(),\n        short: short.trim(),\n        parents: parents.trim() ? parents.trim().split(/\\s+/) : [],\n        author: author.trim(),\n        date: new Date(iso.trim()),\n        refs: refs\n          .split(\",\")\n          .map((r) => r.trim())\n          .filter(Boolean),\n        subject: p.slice(6).join(\"|\"),\n        body: \"\",\n        stat: null,\n      };\n    }\n\n    // the trailing lines of a record are the body, optionally closed by a --shortstat line\n    function digest(lines) {\n      let stat = null;\n      const keep = [];\n      lines.forEach((l) => {\n        const m = l.match(STAT);\n        if (m) stat = { files: +m[1], add: +(m[2] || 0), del: +(m[3] || 0) };\n        else keep.push(l);\n      });\n      return { body: keep.join(\"\\n\").trim(), stat };\n    }\n\n    function parse(raw) {\n      const lines = raw.split(/\\r?\\n/);\n\n      // flat form: one commit per line, no body or stats\n      if (!lines.some((l) => l.startsWith(MARK))) {\n        return lines.map((l) => (l.trim() ? record(l) : null)).filter(Boolean);\n      }\n\n      const out = [];\n      let cur = null,\n        buf = [];\n      const flush = () => {\n        if (!cur) return;\n        Object.assign(cur, digest(buf));\n        out.push(cur);\n        buf = [];\n      };\n      lines.forEach((line) => {\n        if (line.startsWith(MARK)) {\n          flush();\n          cur = record(line.slice(MARK.length));\n        } else if (cur) buf.push(line);\n      });\n      flush();\n      return out;\n    }\n\n    /* ---------- lane assignment ---------- */\n\n    function assignLanes(list) {\n      const lanes = [];\n      list.forEach((c) => {\n        let i = lanes.indexOf(c.full);\n        if (i < 0) {\n          i = lanes.indexOf(null);\n          if (i < 0) {\n            i = lanes.length;\n            lanes.push(null);\n          }\n        }\n        c.lane = i;\n        lanes.forEach((v, j) => {\n          if (v === c.full && j !== i) lanes[j] = null;\n        });\n        lanes[i] = c.parents[0] || null;\n        for (let k = 1; k < c.parents.length; k++) {\n          const p = c.parents[k];\n          if (lanes.includes(p)) continue;\n          let j = lanes.indexOf(null);\n          if (j < 0) {\n            j = lanes.length;\n            lanes.push(null);\n          }\n          lanes[j] = p;\n        }\n      });\n      return list.reduce((m, c) => Math.max(m, c.lane), 0);\n    }\n\n    const laneColor = (n) => `var(--l${n % LANES})`;\n    const x = (lane) => PAD_X + lane * LANE_W;\n    const y = (i) => i * PITCH + PITCH / 2;\n\n    /* ---------- drawing ---------- */\n\n    function drawRails(maxLane) {\n      rails.textContent = \"\";\n      const w = PAD_X * 2 + maxLane * LANE_W;\n      const h = commits.length * PITCH;\n      document.documentElement.style.setProperty(\"--gutter\", w + \"px\");\n      rails.setAttribute(\"width\", w);\n      rails.setAttribute(\"height\", h);\n      rails.setAttribute(\"viewBox\", `0 0 ${w} ${h}`);\n\n      const edges = document.createElementNS(NS, \"g\");\n      const nodes = document.createElementNS(NS, \"g\");\n      rails.append(edges, nodes);\n\n      commits.forEach((c, i) => {\n        const x1 = x(c.lane);\n        const y1 = y(i);\n\n        c.parents.forEach((ph, k) => {\n          const p = byHash.get(ph);\n          const path = document.createElementNS(NS, \"path\");\n          let d;\n          if (!p) {\n            d = `M${x1} ${y1} V${y1 + PITCH * 0.55}`;\n            path.setAttribute(\"stroke-dasharray\", \"2 4\");\n            path.setAttribute(\"opacity\", \"0.5\");\n          } else {\n            const x2 = x(p.lane);\n            const y2 = y(p.i);\n            const dir = x2 > x1 ? 1 : -1;\n            const R = Math.max(0, Math.min(8, Math.abs(x2 - x1), (y2 - y1) / 2));\n            if (x1 === x2) {\n              // straight run down the lane\n              d = `M${x1} ${y1} V${y2}`;\n            } else if (R === 0) {\n              d = `M${x1} ${y1} L${x2} ${y2}`;\n            } else if (k === 0) {\n              // first parent in another lane: hold this lane, swing across just above the parent\n              d = `M${x1} ${y1} V${y2 - R} A${R} ${R} 0 0 ${dir > 0 ? 0 : 1} ${x1 + dir * R} ${y2} H${x2}`;\n            } else {\n              // merge parent: leave the merge node sideways, then drop down the parent's lane\n              d = `M${x1} ${y1} H${x2 - dir * R} A${R} ${R} 0 0 ${dir > 0 ? 1 : 0} ${x2} ${y1 + R} V${y2}`;\n            }\n            path.dataset.from = i;\n            path.dataset.to = p.i;\n          }\n          path.setAttribute(\"d\", d);\n          path.setAttribute(\"fill\", \"none\");\n          path.setAttribute(\"stroke\", laneColor(k === 0 ? c.lane : (p ? p.lane : c.lane)));\n          path.setAttribute(\"stroke-width\", \"2\");\n          path.setAttribute(\"stroke-linecap\", \"round\");\n          path.classList.add(\"edge\");\n          edges.appendChild(path);\n        });\n\n        let node;\n        if (c.parents.length === 0) {\n          node = document.createElementNS(NS, \"rect\");\n          node.setAttribute(\"x\", x1 - 3.5);\n          node.setAttribute(\"y\", y1 - 3.5);\n          node.setAttribute(\"width\", 7);\n          node.setAttribute(\"height\", 7);\n          node.setAttribute(\"fill\", laneColor(c.lane));\n        } else {\n          node = document.createElementNS(NS, \"circle\");\n          node.setAttribute(\"cx\", x1);\n          node.setAttribute(\"cy\", y1);\n          node.setAttribute(\"r\", c.parents.length > 1 ? 4.2 : 3.8);\n          if (c.parents.length > 1) {\n            node.setAttribute(\"fill\", \"var(--surface)\");\n            node.setAttribute(\"stroke\", laneColor(c.lane));\n            node.setAttribute(\"stroke-width\", \"2\");\n          } else {\n            node.setAttribute(\"fill\", laneColor(c.lane));\n          }\n        }\n        node.classList.add(\"node\");\n        node.dataset.i = i;\n        nodes.appendChild(node);\n      });\n    }\n\n    /* ---------- rows ---------- */\n\n    function relative(d) {\n      const s = (Date.now() - d.getTime()) / 1000;\n      if (s < 3600) return Math.max(1, Math.round(s / 60)) + \"m ago\";\n      if (s < 86400) return Math.round(s / 3600) + \"h ago\";\n      if (s < 86400 * 30) return Math.round(s / 86400) + \"d ago\";\n      if (s < 86400 * 365) return Math.round(s / (86400 * 30)) + \"mo ago\";\n      return Math.round(s / (86400 * 365)) + \"y ago\";\n    }\n\n    function refKind(r) {\n      if (r.startsWith(\"HEAD\")) return \"head\";\n      if (r.startsWith(\"tag:\")) return \"tag\";\n      if (/^[\\w.-]+\\/.+/.test(r)) return \"remote\";\n      return \"local\";\n    }\n\n    function drawRows() {\n      rowsEl.textContent = \"\";\n      commits.forEach((c, i) => {\n        const row = document.createElement(\"div\");\n        row.className = \"row\";\n        row.dataset.i = i;\n        row.tabIndex = 0;\n        row.setAttribute(\"role\", \"button\");\n\n        const subj = document.createElement(\"div\");\n        subj.className = \"subject\";\n        const msg = document.createElement(\"span\");\n        msg.className = \"msg\";\n        const m = c.subject.match(/^([a-z]+(\\([^)]+\\))?!?:)\\s*(.*)$/);\n        if (m) {\n          const scope = document.createElement(\"em\");\n          scope.textContent = m[1] + \" \";\n          msg.append(scope, document.createTextNode(m[3]));\n        } else {\n          msg.textContent = c.subject;\n        }\n        subj.appendChild(msg);\n\n        if (c.refs.length) {\n          const refs = document.createElement(\"div\");\n          refs.className = \"refs\";\n          c.refs.forEach((r) => {\n            const kind = refKind(r);\n            const chip = document.createElement(\"span\");\n            chip.className = \"ref\";\n            chip.dataset.kind = kind;\n            chip.innerHTML = GLYPH[kind === \"tag\" ? \"tag\" : \"branch\"];\n            chip.append(\n              document.createTextNode(r.replace(\"HEAD -> \", \"\").replace(\"tag: \", \"\").replace(\"HEAD\", \"detached\"))\n            );\n            chip.title = r;\n            refs.appendChild(chip);\n          });\n          subj.appendChild(refs);\n        }\n\n        const who = document.createElement(\"div\");\n        who.className = \"who\";\n        who.textContent = c.author;\n\n        const when = document.createElement(\"div\");\n        when.className = \"when\";\n        when.textContent = relative(c.date);\n        when.title = c.date.toLocaleString();\n\n        const sha = document.createElement(\"div\");\n        sha.className = \"sha\";\n        sha.textContent = c.short;\n\n        row.append(subj, who, when, sha);\n        row.addEventListener(\"click\", () => select(selected === i ? null : i));\n        row.addEventListener(\"keydown\", (e) => {\n          if (e.key === \"Enter\" || e.key === \" \") {\n            e.preventDefault();\n            select(selected === i ? null : i);\n          }\n        });\n        armHover(row, i);\n        rowsEl.appendChild(row);\n      });\n    }\n\n    /* ---------- hover card ---------- */\n\n    const card = $(\"card\");\n    let hoverTimer = null,\n      hideTimer = null,\n      cardFor = null;\n\n    const initials = (name) =>\n      name\n        .split(/\\s+/)\n        .filter(Boolean)\n        .slice(0, 2)\n        .map((w) => w[0].toUpperCase())\n        .join(\"\");\n\n    function absolute(d) {\n      return d.toLocaleString(undefined, {\n        weekday: \"short\",\n        day: \"numeric\",\n        month: \"short\",\n        year: \"numeric\",\n        hour: \"numeric\",\n        minute: \"2-digit\",\n      });\n    }\n\n    function showCard(i, anchor) {\n      const c = commits[i];\n      cardFor = i;\n\n      const av = $(\"cardAvatar\");\n      av.textContent = initials(c.author);\n      av.style.background = authorColor.get(c.author) || \"var(--ink-3)\";\n      $(\"cardAuthor\").textContent = c.author;\n      $(\"cardWhen\").textContent = `${relative(c.date)} · ${absolute(c.date)}`;\n      $(\"cardSubject\").textContent = c.subject;\n\n      const body = $(\"cardBody\");\n      body.textContent = c.body || \"\";\n      body.style.display = c.body ? \"block\" : \"none\";\n\n      const stat = $(\"cardStat\");\n      if (c.stat) {\n        stat.style.display = \"flex\";\n        stat.innerHTML =\n          `<span>${c.stat.files} file${c.stat.files === 1 ? \"\" : \"s\"} changed</span>` +\n          `<span class=\"add\">+${c.stat.add}</span><span class=\"del\">−${c.stat.del}</span>`;\n      } else {\n        stat.style.display = \"none\";\n      }\n\n      const hash = $(\"cardHash\");\n      hash.innerHTML = GLYPH.copy;\n      hash.append(document.createTextNode(c.short));\n\n      const link = $(\"cardLink\");\n      if (repoBase) {\n        link.style.display = \"inline-flex\";\n        link.href = `${repoBase}/commit/${c.full}`;\n        link.innerHTML = GLYPH.external;\n        link.append(document.createTextNode(\"Open on GitHub\"));\n      } else {\n        link.style.display = \"none\";\n      }\n\n      card.dataset.open = \"true\";\n\n      // anchor under the row, flipping up when it would fall off the bottom\n      const r = anchor.getBoundingClientRect();\n      const cw = card.offsetWidth,\n        ch = card.offsetHeight;\n      const left = Math.max(12, Math.min(r.left + 40, window.innerWidth - cw - 12));\n      const below = r.bottom + 8;\n      const top = below + ch > window.innerHeight - 12 ? Math.max(12, r.top - ch - 8) : below;\n      card.style.left = left + \"px\";\n      card.style.top = top + \"px\";\n    }\n\n    function hideCard() {\n      card.dataset.open = \"false\";\n      cardFor = null;\n    }\n\n    function armHover(row, i) {\n      row.addEventListener(\"mouseenter\", () => {\n        clearTimeout(hideTimer);\n        clearTimeout(hoverTimer);\n        hoverTimer = setTimeout(() => showCard(i, row), 280);\n      });\n      row.addEventListener(\"mouseleave\", () => {\n        clearTimeout(hoverTimer);\n        hideTimer = setTimeout(hideCard, 180);\n      });\n      row.addEventListener(\"focus\", () => showCard(i, row));\n      row.addEventListener(\"blur\", () => {\n        if (!card.contains(document.activeElement)) hideCard();\n      });\n    }\n\n    card.addEventListener(\"mouseenter\", () => clearTimeout(hideTimer));\n    card.addEventListener(\"mouseleave\", () => (hideTimer = setTimeout(hideCard, 180)));\n    window.addEventListener(\"scroll\", hideCard, { passive: true });\n\n    $(\"cardHash\").addEventListener(\"click\", async () => {\n      if (cardFor === null) return;\n      await navigator.clipboard.writeText(commits[cardFor].full);\n      const b = $(\"cardHash\");\n      const was = commits[cardFor].short;\n      b.textContent = \"Copied\";\n      setTimeout(() => {\n        b.innerHTML = GLYPH.copy;\n        b.append(document.createTextNode(was));\n      }, 1200);\n    });\n\n    /* ---------- filtering + selection ---------- */\n\n    function ancestry(i) {\n      const set = new Set([i]);\n      const stack = [commits[i]];\n      while (stack.length) {\n        const c = stack.pop();\n        c.parents.forEach((p) => {\n          const n = byHash.get(p);\n          if (n && !set.has(n.i)) {\n            set.add(n.i);\n            stack.push(n);\n          }\n        });\n      }\n      return set;\n    }\n\n    function apply() {\n      const q = $(\"search\").value.trim().toLowerCase();\n      const anc = selected === null ? null : ancestry(selected);\n      let shown = 0;\n\n      commits.forEach((c, i) => {\n        const hit =\n          !q ||\n          c.subject.toLowerCase().includes(q) ||\n          c.author.toLowerCase().includes(q) ||\n          c.full.toLowerCase().startsWith(q) ||\n          c.refs.join(\" \").toLowerCase().includes(q);\n        const live = hit && !mutedAuthors.has(c.author) && (!anc || anc.has(i));\n        if (live) shown++;\n        const row = rowsEl.children[i];\n        row.dataset.dim = live ? \"false\" : \"true\";\n        row.dataset.sel = selected === i ? \"true\" : \"false\";\n      });\n\n      rails.querySelectorAll(\".node\").forEach((n) => {\n        const live = rowsEl.children[+n.dataset.i].dataset.dim === \"false\";\n        n.setAttribute(\"opacity\", live ? \"1\" : \"0.22\");\n      });\n      rails.querySelectorAll(\".edge\").forEach((e) => {\n        const a = e.dataset.from,\n          b = e.dataset.to;\n        const live =\n          a === undefined ||\n          (rowsEl.children[+a].dataset.dim === \"false\" && rowsEl.children[+b].dataset.dim === \"false\");\n        e.setAttribute(\"opacity\", live ? (e.getAttribute(\"stroke-dasharray\") ? \"0.5\" : \"1\") : \"0.16\");\n      });\n\n      $(\"statCommits\").innerHTML =\n        shown === commits.length\n          ? `<b>${commits.length}</b> commits`\n          : `<b>${shown}</b> of ${commits.length} commits`;\n    }\n\n    function select(i) {\n      selected = i;\n      apply();\n    }\n\n    document.addEventListener(\"keydown\", (e) => {\n      if (e.key !== \"Escape\") return;\n      if ($(\"scrim\").dataset.open === \"true\") closePicker();\n      else if (card.dataset.open === \"true\") hideCard();\n      else if (selected !== null) select(null);\n    });\n\n    /* ---------- authors ---------- */\n\n    function drawAuthors() {\n      const box = $(\"authors\");\n      box.textContent = \"\";\n      const names = [...new Set(commits.map((c) => c.author))].sort(\n        (a, b) =>\n          commits.filter((c) => c.author === b).length - commits.filter((c) => c.author === a).length\n      );\n      authorColor = new Map(names.map((n, k) => [n, laneColor(k)]));\n      names.forEach((n, k) => {\n        const b = document.createElement(\"button\");\n        b.className = \"chip-author\";\n        b.setAttribute(\"aria-pressed\", \"true\");\n        b.style.color = laneColor(k);\n        b.innerHTML = `<i></i><span>${n}</span>`;\n        b.querySelector(\"span\").style.color = \"var(--ink-2)\";\n        b.addEventListener(\"click\", () => {\n          const on = b.getAttribute(\"aria-pressed\") === \"true\";\n          b.setAttribute(\"aria-pressed\", on ? \"false\" : \"true\");\n          if (on) mutedAuthors.add(n);\n          else mutedAuthors.delete(n);\n          apply();\n        });\n        box.appendChild(b);\n      });\n    }\n\n    /* ---------- load ---------- */\n\n    // merge subjects like \"Merge branch 'x' of https://github.com/org/repo\" name the remote for us\n    function inferRepo(raw) {\n      const m = raw.match(/github\\.com[/:]([\\w.-]+)\\/([\\w.-]+?)(?:\\.git)?(?=[\\s/'\"]|$)/im);\n      return m ? `https://github.com/${m[1]}/${m[2]}` : \"\";\n    }\n\n    function load(raw, name) {\n      const list = parse(raw);\n      if (!list.length) {\n        // keep whatever graph is already on screen rather than blanking it\n        if (!commits.length)\n          rowsEl.innerHTML = '<div class=\"empty\">No commits found &mdash; check the command output.</div>';\n        return false;\n      }\n      commits = list;\n      repoBase = remoteOverride || inferRepo(raw);\n      hideCard();\n      byHash = new Map();\n      commits.forEach((c, i) => {\n        c.i = i;\n        byHash.set(c.full, c);\n      });\n      selected = null;\n      mutedAuthors = new Set();\n      const maxLane = assignLanes(commits);\n      drawRails(maxLane);\n      drawRows();\n      drawAuthors();\n      const a = commits[commits.length - 1].date,\n        b = commits[0].date;\n      const fmt = (d) => d.toLocaleDateString(undefined, { day: \"numeric\", month: \"short\", year: \"2-digit\" });\n      $(\"statSpan\").textContent = `${fmt(a)} → ${fmt(b)}`;\n      $(\"title\").textContent = name || \"Commit graph\";\n      apply();\n      return true;\n    }\n\n    /* ---------- saved projects ---------- */\n\n    const readStore = () => {\n      try {\n        return JSON.parse(localStorage.getItem(STORE) || \"{}\");\n      } catch (e) {\n        return {};\n      }\n    };\n    const writeStore = (o) => localStorage.setItem(STORE, JSON.stringify(o));\n\n    function drawSaved() {\n      const box = $(\"saved\");\n      const store = readStore();\n      box.textContent = \"\";\n      const label = document.createElement(\"span\");\n      label.className = \"label\";\n      label.textContent = Object.keys(store).length ? \"Saved\" : \"Nothing saved yet\";\n      box.appendChild(label);\n      Object.keys(store).forEach((name) => {\n        const b = document.createElement(\"button\");\n        b.innerHTML = `${name}<span>×</span>`;\n        b.style.textTransform = \"none\";\n        b.style.letterSpacing = \"0\";\n        b.style.fontSize = \"12px\";\n        b.addEventListener(\"click\", (e) => {\n          if (e.target.tagName === \"SPAN\") {\n            const s = readStore();\n            delete s[name];\n            writeStore(s);\n            drawSaved();\n            return;\n          }\n          load(store[name], name);\n          $(\"paste\").value = store[name];\n          $(\"projName\").value = name;\n        });\n        box.appendChild(b);\n      });\n    }\n\n    $(\"toggleLoader\").addEventListener(\"click\", () => {\n      const p = $(\"loader\");\n      const open = p.dataset.open === \"true\";\n      p.dataset.open = open ? \"false\" : \"true\";\n      $(\"toggleLoader\").setAttribute(\"aria-expanded\", String(!open));\n      if (!open) $(\"paste\").focus();\n    });\n\n    // the pipe that lands the output on the clipboard differs per OS\n    const GITLOG =\n      'git log --all --date-order -200 --shortstat --pretty=format:\"@@@%H|%h|%P|%an|%aI|%D|%s%n%b\"';\n    const plat = navigator.userAgent;\n    const sink = /Win/i.test(plat) ? \" | clip\" : /Mac/i.test(plat) ? \" | pbcopy\" : \" | xclip -selection clipboard\";\n    $(\"cmdText\").textContent = GITLOG + sink;\n\n    $(\"copyCmd\").addEventListener(\"click\", async () => {\n      await navigator.clipboard.writeText($(\"cmdText\").textContent);\n      $(\"copyCmd\").textContent = \"Copied\";\n      setTimeout(() => ($(\"copyCmd\").textContent = \"Copy\"), 1400);\n    });\n\n    function hint(msg, bad) {\n      const h = $(\"loadHint\");\n      h.textContent = msg;\n      h.dataset.tone = bad ? \"bad\" : \"\";\n    }\n\n    // name a project after its checked-out branch unless the viewer names it themselves\n    function inferName(raw) {\n      const typed = $(\"projName\").value.trim();\n      if (typed) return typed;\n      const m = raw.match(/HEAD -> ([^,|\\n]+)/);\n      return m ? m[1].trim() : \"\";\n    }\n\n    function commit(raw) {\n      const name = inferName(raw);\n      if (!load(raw, name)) {\n        hint(\"That didn't look like git log output — check the format above.\", true);\n        return;\n      }\n      if (name) {\n        const s = readStore();\n        s[name] = raw;\n        writeStore(s);\n        drawSaved();\n      }\n      $(\"paste\").value = raw;\n      $(\"projName\").value = name;\n      hint(\"or paste / drop the output below\", false);\n      $(\"loader\").dataset.open = \"false\";\n      $(\"toggleLoader\").setAttribute(\"aria-expanded\", \"false\");\n    }\n\n    $(\"fromClipboard\").addEventListener(\"click\", async () => {\n      try {\n        const raw = await navigator.clipboard.readText();\n        if (!raw.trim()) return hint(\"Clipboard is empty — run the command first.\", true);\n        commit(raw);\n      } catch (e) {\n        hint(\"Your browser blocked clipboard access — paste into the box instead.\", true);\n        $(\"paste\").focus();\n      }\n    });\n\n    // pasting is the whole gesture: no second click\n    $(\"paste\").addEventListener(\"paste\", (e) => {\n      const raw = (e.clipboardData || window.clipboardData).getData(\"text\");\n      if (!raw || !raw.trim()) return;\n      e.preventDefault();\n      commit(raw);\n    });\n\n    // dropping a saved log file works too\n    const panel = $(\"loader\");\n    [\"dragenter\", \"dragover\"].forEach((t) =>\n      panel.addEventListener(t, (e) => {\n        e.preventDefault();\n        panel.dataset.drop = \"true\";\n      })\n    );\n    [\"dragleave\", \"drop\"].forEach((t) =>\n      panel.addEventListener(t, (e) => {\n        e.preventDefault();\n        panel.dataset.drop = \"false\";\n      })\n    );\n    panel.addEventListener(\"drop\", async (e) => {\n      const f = e.dataTransfer.files[0];\n      if (f) commit(await f.text());\n    });\n\n    $(\"render\").addEventListener(\"click\", () => commit($(\"paste\").value));\n\n    $(\"search\").addEventListener(\"input\", apply);\n\n    /* ---------- live mode ----------\n       Only when this page is being served by the local runner. The published artifact\n       is sandboxed and same-origin-less, so it never even attempts this. */\n\n    const LOCAL =\n      /^https?:$/.test(location.protocol) && /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);\n\n    let autoTimer = null;\n\n    function liveHint(msg, bad) {\n      const h = $(\"liveHint\");\n      h.hidden = false;\n      h.textContent = msg;\n      h.dataset.tone = bad ? \"bad\" : \"\";\n    }\n\n    let syncState = null;\n    let pushStateNow = null;\n    let repoId = null;\n    const REPO_KEY = \"commit-graph.repo\";\n\n    function drawRepos(list, current) {\n      const s = $(\"repoPick\");\n      if (!list || !list.length) return;\n      s.hidden = false;\n      const sig = list.map((r) => r.name).join(\"|\");\n      if (s.dataset.sig !== sig) {\n        s.dataset.sig = sig;\n        s.textContent = \"\";\n        list.forEach((r) => {\n          const o = document.createElement(\"option\");\n          o.value = String(r.id);\n          o.textContent = r.name;\n          s.appendChild(o);\n        });\n        const add = document.createElement(\"option\");\n        add.value = \"__add\";\n        add.textContent = \"Add a repo…\";\n        s.appendChild(add);\n      }\n      s.value = String(current);\n      const here = list.find((r) => r.id === current);\n      if (here) localStorage.setItem(REPO_KEY, here.name);\n    }\n\n    const FOLDER = {\n      plain:\n        '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z\"/></svg>',\n      repo:\n        '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z\"/><circle cx=\"12\" cy=\"13\" r=\"2.2\" fill=\"currentColor\" stroke=\"none\"/></svg>',\n    };\n\n    let pickAt = null;\n\n    async function openPicker(at) {\n      $(\"scrim\").dataset.open = \"true\";\n      const list = $(\"pickList\");\n      list.innerHTML = '<div class=\"picker-empty\">Reading…</div>';\n      try {\n        const res = await fetch(`/api/browse${at ? `?path=${encodeURIComponent(at)}` : \"\"}`, {\n          cache: \"no-store\",\n        });\n        const d = await res.json();\n        if (!res.ok) throw new Error(d.error);\n        pickAt = d.path;\n        $(\"pickPath\").textContent = d.path;\n        $(\"pickPath\").title = d.path;\n        $(\"pickUp\").disabled = !d.parent;\n        $(\"pickUp\").dataset.parent = d.parent || \"\";\n        $(\"pickAdd\").disabled = !d.repo;\n        $(\"pickAdd\").textContent = d.repo ? \"Add this folder\" : \"Not a repo\";\n\n        list.textContent = \"\";\n        if (!d.entries.length) list.innerHTML = '<div class=\"picker-empty\">No sub-folders here.</div>';\n        d.entries.forEach((e) => {\n          const b = document.createElement(\"button\");\n          b.className = \"picker-row\";\n          b.dataset.repo = String(e.repo);\n          b.innerHTML = (e.repo ? FOLDER.repo : FOLDER.plain) + `<span>${e.name}</span>`;\n          if (e.repo) {\n            const tag = document.createElement(\"span\");\n            tag.className = \"badge\";\n            tag.textContent = \"git\";\n            b.appendChild(tag);\n          }\n          // a repo is the thing you're choosing; anything else is a step on the way\n          b.addEventListener(\"click\", () =>\n            e.repo ? addRepo(`${d.path}/${e.name}`) : openPicker(`${d.path}/${e.name}`)\n          );\n          list.appendChild(b);\n        });\n      } catch (e) {\n        list.innerHTML = `<div class=\"picker-empty\">${e.message || e}</div>`;\n      }\n    }\n\n    function closePicker() {\n      $(\"scrim\").dataset.open = \"false\";\n      $(\"repoPick\").value = String(repoId);\n    }\n\n    async function addRepo(p) {\n      try {\n        const res = await fetch(`/api/repos?path=${encodeURIComponent(p)}`, {\n          method: \"POST\",\n          headers: { \"x-git-graph\": \"1\" },\n        });\n        const data = await res.json();\n        if (!res.ok) return liveHint(data.error, true);\n        const norm = (s) => s.replace(/\\\\/g, \"/\").toLowerCase();\n        const added = data.repos.find((r) => norm(r.path) === norm(p));\n        closePicker();\n        drawRepos(data.repos, added ? added.id : repoId);\n        if (added) {\n          repoId = added.id;\n          syncState = null;\n          selected = null;\n          await pull(true);\n        }\n      } catch (e) {\n        liveHint(String(e.message || e), true);\n      }\n    }\n\n    // the button says exactly what the click will do, and disables when it would do nothing\n    function drawSync() {\n      const b = $(\"sync\");\n      if (!syncState || syncState.missing) {\n        b.hidden = true;\n        return;\n      }\n      b.hidden = false;\n      const { target, ahead, behind, dirty } = syncState;\n      if (dirty) {\n        b.disabled = true;\n        b.textContent = `${target} — commit or stash first`;\n        b.title = \"Syncing needs a clean working tree\";\n      } else if (behind === 0) {\n        b.disabled = true;\n        b.textContent = `up to date with ${target}`;\n        b.title = \"\";\n      } else {\n        b.disabled = false;\n        const how = ahead === 0 ? \"fast-forward\" : `rebase ${ahead} on top`;\n        b.innerHTML = `${how} ← ${target} <b>${behind}↓</b>`;\n        b.title =\n          ahead === 0\n            ? `Fast-forward this branch ${behind} commit(s) to ${target}`\n            : `Replay your ${ahead} commit(s) on top of ${target}; aborts untouched if it would conflict`;\n      }\n    }\n\n    function drawPush() {\n      const b = $(\"push\");\n      const p = pushStateNow;\n      if (!p || !p.branch) {\n        b.hidden = true;\n        return;\n      }\n      b.hidden = false;\n      if (!p.upstream) {\n        b.disabled = false;\n        b.textContent = `publish → origin/${p.branch}`;\n        b.title = `Push ${p.branch} to origin and track it`;\n      } else if (p.behind > 0) {\n        b.disabled = true;\n        b.textContent = `push blocked — ${p.behind}↓ on ${p.upstream}`;\n        b.title = \"Sync first; this tool never force-pushes\";\n      } else if (p.ahead === 0) {\n        b.disabled = true;\n        b.textContent = `nothing to push`;\n        b.title = \"\";\n      } else {\n        b.disabled = false;\n        b.innerHTML = `push <b>${p.ahead}↑</b> → ${p.upstream}`;\n        b.title = `Push ${p.ahead} commit(s) to ${p.upstream}`;\n      }\n    }\n\n    async function doPush() {\n      const b = $(\"push\");\n      const was = b.innerHTML;\n      b.disabled = true;\n      b.textContent = \"Pushing…\";\n      try {\n        const res = await fetch(`/api/push?repo=${repoId}`, {\n          method: \"POST\",\n          headers: { \"x-git-graph\": \"1\" },\n        });\n        const r = await res.json();\n        if (!res.ok) {\n          liveHint(r.error, true);\n          b.innerHTML = was;\n          b.disabled = false;\n          return;\n        }\n        await pull(true);\n        liveHint(\n          r.action === \"none\"\n            ? \"nothing to push\"\n            : r.action === \"published\"\n              ? `published ${r.branch} → ${r.upstream}`\n              : `pushed ${r.pushed} → ${r.upstream}`\n        );\n      } catch (e) {\n        liveHint(String(e.message || e), true);\n        b.innerHTML = was;\n        b.disabled = false;\n      }\n    }\n\n    async function doSync() {\n      const b = $(\"sync\");\n      const was = b.innerHTML;\n      b.disabled = true;\n      b.textContent = \"Syncing…\";\n      try {\n        const res = await fetch(\n          `/api/sync?repo=${repoId}&target=${encodeURIComponent(syncState.target)}`,\n          { method: \"POST\", headers: { \"x-git-graph\": \"1\" } }\n        );\n        const r = await res.json();\n        if (!res.ok) {\n          liveHint(r.conflicts?.length ? `${r.error}: ${r.conflicts.slice(0, 3).join(\", \")}` : r.error, true);\n          b.innerHTML = was;\n          b.disabled = false;\n          return;\n        }\n        await pull(false);\n        liveHint(\n          r.action === \"none\"\n            ? `already up to date with ${r.target}`\n            : `${r.action} · ${r.branch} ← ${r.target} · undo: ${r.undo}`\n        );\n      } catch (e) {\n        liveHint(String(e.message || e), true);\n        b.innerHTML = was;\n        b.disabled = false;\n      }\n    }\n\n    // a fetch on a big repo can outlive a later request; only the newest one may paint\n    let pullSeq = 0;\n\n    async function pull(doFetch) {\n      const seq = ++pullSeq;\n      const btn = $(\"refresh\");\n      const was = btn.textContent;\n      btn.disabled = true;\n      btn.textContent = doFetch ? \"Fetching…\" : \"Loading…\";\n      try {\n        const q = new URLSearchParams();\n        if (doFetch) q.set(\"fetch\", \"1\");\n        if (repoId !== null) q.set(\"repo\", String(repoId));\n        const res = await fetch(`/api/log?${q}`, { cache: \"no-store\" });\n        const data = await res.json();\n        if (seq !== pullSeq) return; // superseded while in flight — drop it\n        if (!res.ok) throw new Error(data.error || \"runner error\");\n        repoId = data.repoId;\n        drawRepos(data.repos, data.repoId);\n        syncState = data.sync;\n        pushStateNow = data.push;\n        drawSync();\n        drawPush();\n\n        const before = new Set(commits.map((c) => c.full));\n        remoteOverride = data.remote || \"\";\n        // the picker already names the repo, so the heading carries the branch\n        if (!load(data.log, LOCAL ? data.branch : `${data.repo} · ${data.branch}`))\n          throw new Error(\"no commits in this repo\");\n\n        const fresh = commits.filter((c) => !before.has(c.full)).length;\n        const time = new Date().toLocaleTimeString(undefined, { hour: \"numeric\", minute: \"2-digit\" });\n        liveHint(before.size === 0 ? `live · ${time}` : `${fresh ? `+${fresh} new` : \"up to date\"} · ${time}`);\n      } catch (e) {\n        if (seq === pullSeq) liveHint(String(e.message || e), true);\n      } finally {\n        if (seq === pullSeq) {\n          btn.disabled = false;\n          btn.textContent = was;\n        }\n      }\n    }\n\n    if (LOCAL) {\n      $(\"refresh\").hidden = false;\n      $(\"auto\").hidden = false;\n      $(\"refresh\").addEventListener(\"click\", () => pull(true));\n      $(\"sync\").addEventListener(\"click\", doSync);\n      $(\"push\").addEventListener(\"click\", doPush);\n      $(\"pickUp\").addEventListener(\"click\", (e) => openPicker(e.target.dataset.parent || null));\n      $(\"pickAdd\").addEventListener(\"click\", () => pickAt && addRepo(pickAt));\n      $(\"pickCancel\").addEventListener(\"click\", closePicker);\n      $(\"scrim\").addEventListener(\"click\", (e) => e.target === $(\"scrim\") && closePicker());\n\n      $(\"repoPick\").addEventListener(\"change\", (e) => {\n        if (e.target.value === \"__add\") return openPicker(null);\n        repoId = Number(e.target.value);\n        syncState = null;\n        pushStateNow = null;\n        selected = null;\n        $(\"search\").value = \"\";\n        pull(true);\n      });\n      $(\"auto\").addEventListener(\"click\", () => {\n        const b = $(\"auto\");\n        const on = b.getAttribute(\"aria-pressed\") === \"true\";\n        b.setAttribute(\"aria-pressed\", on ? \"false\" : \"true\");\n        clearInterval(autoTimer);\n        autoTimer = on ? null : setInterval(() => pull(true), 60000);\n        if (!on) pull(true);\n      });\n    }\n\n    drawSaved();\n    if (SEED.trim()) load(SEED, SEED_NAME);\n    else if (LOCAL) rowsEl.innerHTML = '<div class=\"empty\">Reading this repo…</div>';\n    // fetch on open, so the sync button reflects the remote rather than a stale clone,\n    // and reopen on whichever repo this tab was last looking at\n    if (LOCAL)\n      (async () => {\n        try {\n          const list = (await (await fetch(\"/api/repos\", { cache: \"no-store\" })).json()).repos;\n          const want = list.find((r) => r.name === localStorage.getItem(REPO_KEY));\n          if (want) repoId = want.id;\n          drawRepos(list, want ? want.id : 0);\n        } catch {\n          // no list endpoint reachable; pull() still falls back to the launch repo\n        }\n        pull(true);\n      })();\n  })();\n</script>\n";

const git = async (args, at) => (await run("git", args, { cwd: at, maxBuffer: 64 * 1024 * 1024 })).stdout;

const isRepo = (p) => {
  try {
    return fs.existsSync(path.join(p, ".git"));
  } catch {
    return false;
  }
};

/**
 * Every repo this instance can show: the one you launched in, its siblings on
 * disk, any extra paths on the command line, and anything added from the UI.
 * The page picks by index, so a page can never point git at an arbitrary path.
 */
let repos = [];
let launchRoot = cwd;

// ids are positions in this list; it only ever appends, so a repo's id is stable
// for the life of the process even as repos appear or disappear on disk
const order = [];

function discover(launch) {
  const found = [launch];
  const parent = path.dirname(launch);
  try {
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = path.join(parent, entry.name);
      if (p !== launch && isRepo(p)) found.push(p);
    }
  } catch {
    // parent unreadable — the launch repo alone is fine
  }
  for (const extra of [...extraPaths, ...readSaved()]) {
    const p = path.resolve(clean(extra));
    if (isRepo(p) && !found.includes(p)) found.push(p);
  }
  for (const p of found) if (!order.includes(p)) order.push(p);
  repos = order.map((p, id) => ({ id, name: path.basename(p), path: p, gone: !isRepo(p) }));
}

/** repos still on disk, for the picker */
const liveRepos = () => repos.filter((r) => !r.gone).map(({ id, name, path: p }) => ({ id, name, path: p }));

const SAVED = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".claude", "git-graph-repos.json");

function readSaved() {
  try {
    return JSON.parse(fs.readFileSync(SAVED, "utf8"));
  } catch {
    return [];
  }
}

function save(list) {
  try {
    fs.mkdirSync(path.dirname(SAVED), { recursive: true });
    fs.writeFileSync(SAVED, JSON.stringify(list, null, 2));
  } catch (e) {
    console.error("could not save repo list:", e.message);
  }
}

const repoAt = (id) => repos[Number(id)] || repos[0];

// "Copy as path" on Windows wraps the path in quotes; drag-and-drop can add whitespace
const clean = (p) => (p || "").trim().replace(/^["']|["']$/g, "").trim();

/** directory listing for the folder picker — names only, never file contents */
function browse(at) {
  const dir = at ? path.resolve(clean(at)) : path.dirname(launchRoot);
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => ({ name: e.name, repo: isRepo(path.join(dir, e.name)) }))
    .sort((a, b) => (a.repo === b.repo ? a.name.localeCompare(b.name) : a.repo ? -1 : 1));
  const up = path.dirname(dir);
  return { path: dir, parent: up === dir ? null : up, repo: isRepo(dir), entries };
}

/** the ref to sync from: the requested one, else this branch's own upstream */
async function resolveTarget(at, wanted) {
  if (wanted && /^[\w.\-/]+$/.test(wanted)) {
    try {
      await git(["rev-parse", "--verify", "--quiet", wanted], at);
      return wanted;
    } catch {
      // not in this repo — fall through to the upstream
    }
  }
  try {
    return (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], at)).trim();
  } catch {
    return null;
  }
}

/** how far HEAD sits from a target ref, plus whether the tree is clean */
async function tracking(at, wanted) {
  const target = await resolveTarget(at, wanted);
  if (!target) return { target: wanted || null, missing: true };
  const counts = await git(["rev-list", "--left-right", "--count", `${target}...HEAD`], at);
  const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
  const dirty = (await git(["status", "--porcelain"], at)).trim().length > 0;
  return { target, ahead, behind, dirty, inferred: target !== wanted };
}

/** where the current branch stands against its own upstream */
async function pushInfo(at) {
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], at)).trim();
  if (branch === "HEAD") return { branch: null };
  let upstream = null;
  try {
    upstream = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], at)).trim();
  } catch {
    return { branch, upstream: null }; // never pushed — publishing would set it
  }
  const [behind, ahead] = (await git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], at))
    .trim()
    .split(/\s+/)
    .map(Number);
  return { branch, upstream, ahead, behind };
}

/**
 * Push the current branch to origin, fast-forward only. Refuses when the
 * upstream has commits we don't — that would need a force push, which this
 * tool will not do under any circumstance.
 */
async function push(at) {
  const info = await pushInfo(at);
  if (!info.branch) throw new Error("detached HEAD — check out a branch first");

  if (!info.upstream) {
    await git(["push", "--set-upstream", "origin", info.branch], at);
    const after = await pushInfo(at);
    return { action: "published", branch: info.branch, upstream: after.upstream, pushed: null };
  }
  if (info.behind > 0)
    throw new Error(
      `${info.upstream} has ${info.behind} commit${info.behind === 1 ? "" : "s"} you don't — sync first, then push`
    );
  if (info.ahead === 0) return { action: "none", branch: info.branch, upstream: info.upstream, pushed: 0 };

  await git(["push"], at);
  return { action: "push", branch: info.branch, upstream: info.upstream, pushed: info.ahead };
}

/**
 * Bring `target` into the checked-out branch: fast-forward when we have no local
 * commits, otherwise rebase. Refuses on a dirty tree, detached HEAD, or an
 * unfinished merge/rebase, and aborts back to the starting commit on conflict.
 * Never pushes, never force-updates a remote.
 */
async function sync(at, wanted) {
  const gitDir = path.resolve(at, (await git(["rev-parse", "--git-dir"], at)).trim());
  for (const f of ["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) {
    if (fs.existsSync(path.join(gitDir, f)))
      throw new Error("a merge or rebase is already in progress — finish or abort it first");
  }

  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], at)).trim();
  if (branch === "HEAD") throw new Error("detached HEAD — check out a branch first");
  if ((await git(["status", "--porcelain"], at)).trim())
    throw new Error("you have uncommitted changes — commit or stash them first");

  await git(["fetch", "--prune", "origin"], at);
  const target = await resolveTarget(at, wanted);
  if (!target) throw new Error(`${wanted} not found, and this branch has no upstream`);

  const before = (await git(["rev-parse", "HEAD"], at)).trim();
  const [behind, ahead] = (await git(["rev-list", "--left-right", "--count", `${target}...HEAD`], at))
    .trim()
    .split(/\s+/)
    .map(Number);

  const done = async (action) => ({
    action,
    branch,
    target,
    ahead,
    behind,
    before,
    after: (await git(["rev-parse", "HEAD"], at)).trim(),
    undo: `git reset --hard ${before.slice(0, 12)}`,
  });

  if (behind === 0) return done("none");
  if (ahead === 0) {
    await git(["merge", "--ff-only", target], at);
    return done("fast-forward");
  }

  try {
    await git(["rebase", target], at);
  } catch (e) {
    let conflicts = [];
    try {
      conflicts = (await git(["diff", "--name-only", "--diff-filter=U"], at)).trim().split("\n").filter(Boolean);
    } catch {
      // couldn't read the conflicted set; the abort below still restores the branch
    }
    try {
      await git(["rebase", "--abort"], at);
    } catch {
      // rebase never started, nothing to abort
    }
    const err = new Error(
      conflicts.length
        ? `rebase hits conflicts in ${conflicts.length} file${conflicts.length === 1 ? "" : "s"} — aborted, nothing changed`
        : `rebase onto ${target} failed — aborted, nothing changed`
    );
    err.conflicts = conflicts;
    throw err;
  }
  return done("rebase");
}

async function snapshot(at, doFetch, target) {
  const root = (await git(["rev-parse", "--show-toplevel"], at)).trim();

  let fetched = false;
  if (doFetch) {
    try {
      await git(["fetch", "--prune", "--all"], at);
      fetched = true;
    } catch {
      // offline, or no remote configured — the local history is still worth drawing
    }
  }

  let remote = "";
  try {
    const url = (await git(["remote", "get-url", "origin"], at)).trim();
    const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
    if (m) remote = `https://github.com/${m[1]}/${m[2]}`;
  } catch {
    // no origin
  }

  let branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], at)).trim();
  if (branch === "HEAD") branch = "detached";

  const log = await git(
    ["log", "--all", "--date-order", `-${COUNT}`, "--shortstat", "--pretty=format:@@@%H|%h|%P|%an|%aI|%D|%s%n%b"],
    at
  );

  return {
    repo: path.basename(root),
    branch,
    remote,
    fetched,
    log,
    defaultTarget: DEFAULT_TARGET,
    sync: await tracking(at, target || DEFAULT_TARGET),
    push: await pushInfo(at),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  const guarded = () => req.method === "POST" && req.headers["x-git-graph"] === "1";

  if (url.pathname === "/api/browse") {
    try {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(browse(url.searchParams.get("path"))));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.code === "EACCES" ? "no permission to read that folder" : e.message }));
    }
    return;
  }

  if (url.pathname === "/api/repos") {
    // adding a repo is a write to the saved list, so it carries the same guard
    if (req.method === "POST") {
      if (!guarded()) {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "POST with x-git-graph: 1" }));
        return;
      }
      const p = path.resolve(clean(url.searchParams.get("path")));
      if (!isRepo(p)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `${p} is not a git repository` }));
        return;
      }
      const saved = readSaved();
      if (!saved.includes(p)) save([...saved, p]);
      discover(launchRoot);
      console.log(`added repo ${p}`);
    }
    discover(launchRoot);
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ repos: liveRepos() }));
    return;
  }

  if (url.pathname === "/api/push") {
    if (!guarded()) {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "POST with x-git-graph: 1" }));
      return;
    }
    try {
      const repo = repoAt(url.searchParams.get("repo"));
      const result = await push(repo.path);
      console.log(`push ${result.action}: ${repo.name} ${result.branch} → ${result.upstream}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      const msg = String(e.stderr || e.message || e).trim().split("\n").filter(Boolean).pop() || "push failed";
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  // writes require a custom header, so a random web page can't POST here cross-origin
  if (url.pathname === "/api/sync") {
    if (!guarded()) {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "POST with x-git-graph: 1" }));
      return;
    }
    try {
      const repo = repoAt(url.searchParams.get("repo"));
      const result = await sync(repo.path, url.searchParams.get("target") || DEFAULT_TARGET);
      console.log(`sync ${result.action}: ${repo.name} ${result.branch} ← ${result.target}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || e).trim(), conflicts: e.conflicts || [] }));
    }
    return;
  }

  if (url.pathname === "/api/log") {
    const repo = repoAt(url.searchParams.get("repo"));
    try {
      const data = await snapshot(repo.path, url.searchParams.get("fetch") === "1", url.searchParams.get("target"));
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ...data, repoId: repo.id, repos: liveRepos().map(({ id, name }) => ({ id, name })) }));
    } catch (e) {
      const msg = /not a git repository/i.test(String(e.stderr || e))
        ? `${repo.path} is not a git repository`
        : String(e.stderr || e.message || e).trim().split("\n")[0];
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(HTML);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is busy — already running? Try: node git-graph.mjs --port ${PORT + 1}`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, "127.0.0.1", async () => {
  let root = cwd;
  try {
    root = (await git(["rev-parse", "--show-toplevel"], cwd)).trim();
  } catch {
    console.error(`${cwd} is not a git repository.`);
    process.exit(1);
  }
  launchRoot = path.resolve(root);
  discover(launchRoot);
  console.log(`git-graph  ${repos[0].name}  (+${repos.length - 1} more in the picker)`);
  console.log(`           http://127.0.0.1:${PORT}   (ctrl-c to stop)`);
});
