import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const dependencies = Object.entries(lock.packages).filter(
  ([directory, info]) => directory && !info.dev,
);
for (const directory of [
  "node_modules/@larksuite/cli",
  "node_modules/electron",
]) {
  dependencies.push([directory, lock.packages[directory]]);
}
const sections = [
  "# Third-party notices",
  "FeiCalendar original application code is licensed under the MIT License in LICENSE. The following components retain their respective copyright notices and licenses. This file is generated from the dependencies pinned in package-lock.json by scripts/generate-notices.mjs.",
  "## ICAL.js source availability",
  "ICAL.js 2.2.1 is used under MPL-2.0. Its unmodified source files and license are included at node_modules/ical.js inside resources/app.asar. The same source distribution is available at https://registry.npmjs.org/ical.js/-/ical.js-2.2.1.tgz and the upstream project is https://github.com/kewisch/ical.js. These source files remain available under MPL-2.0.",
  "## Electron and Chromium",
  "The portable application includes Electron's LICENSE.electron.txt and Chromium's LICENSES.chromium.html in its extracted application directory. The Electron MIT license is also reproduced below. The bundled lark-cli component retains its license at resources/lark-cli/LICENSE.",
];

for (const [directory, info] of dependencies) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const files = (await readdir(directory)).filter((file) =>
    /^(licen[sc]e|copying|notice|copyrightnotice)([._-]|$)/i.test(file),
  );
  if (!files.length) throw new Error(`Missing license text for ${directory}`);
  sections.push(
    `## ${manifest.name} ${info.version}`,
    `License identifier — ${info.license}`,
  );
  for (const file of files.sort()) {
    const content = await readFile(path.join(directory, file), "utf8");
    sections.push(`### ${file}`, `\`\`\`text\n${content.trim()}\n\`\`\``);
  }
}
await writeFile("THIRD_PARTY_NOTICES.md", `${sections.join("\n\n")}\n`);
console.log(
  `Preserved license texts for ${dependencies.length} runtime components`,
);
