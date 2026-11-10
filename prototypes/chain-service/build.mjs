import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as phosphor from "@phosphor-icons/react";

const dir = path.dirname(fileURLToPath(import.meta.url));
const names = ["Buildings", "Storefront", "ChartLineUp", "SquaresFour", "Users", "Target", "ArrowRight", "ArrowLeft", "ArrowUpRight", "Check", "CheckCircle", "Circle", "Clock", "CalendarBlank", "CaretDown", "CaretRight", "Package", "WarningCircle", "Sparkle", "Robot", "ListChecks", "ChatsCircle", "X", "ArrowCounterClockwise", "BookOpen", "MagnifyingGlass", "Funnel", "Info", "ShieldCheck", "Play", "SignOut", "MapPin", "Plus", "TrendUp", "TrendDown", "DotsThree", "ClipboardText", "CheckSquare", "ArrowSquareOut", "UserCircle", "PaperPlaneTilt", "Prohibit", "Lightning", "Receipt", "Coffee"];
const icons = Object.fromEntries(names.map(name => {
  if (!phosphor[name]) throw new Error(`Missing icon: ${name}`);
  return [name, renderToStaticMarkup(React.createElement(phosphor[name], { size: 20, weight: "regular", "aria-hidden": true }))];
}));
const escapeScript = s => s.replaceAll("</script", "<\\/script");
const iconLicense = fs.readFileSync(path.resolve(dir, "../../node_modules/@phosphor-icons/react/LICENSE"), "utf8");
const html = fs.readFileSync(path.join(dir, "template.html"), "utf8")
  .replace("</head>", () => `<!-- Phosphor Icons attribution\n${iconLicense}\n-->\n</head>`)
  .replace("/*__STYLES__*/", () => fs.readFileSync(path.join(dir, "styles.css"), "utf8"))
  .replace("/*__ICONS__*/", () => `window.NeoIcons=${JSON.stringify(icons)};`)
  .replace("/*__MODEL__*/", () => escapeScript(fs.readFileSync(path.join(dir, "model.cjs"), "utf8")))
  .replace("/*__APP__*/", () => escapeScript(fs.readFileSync(path.join(dir, "app.js"), "utf8")));
if (html.includes("/*__")) throw new Error("Unfilled template.");
fs.writeFileSync(path.join(dir, "NEO直营门店协作原型.html"), html);
console.log(`Built standalone prototype: ${Buffer.byteLength(html).toLocaleString()} bytes`);
