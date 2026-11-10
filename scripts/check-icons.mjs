import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NtExecutable, NtExecutableResource } from "pe-library";
import { Data, Resource } from "resedit";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const hash = (bytes) =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");
const iconHash = (icon) => hash(icon.isRaw() ? icon.bin : icon.generate());
const source = Data.IconFile.from(await readFile("build/icon.ico"));
const expected = source.icons.map(({ data }) => iconHash(data)).sort();

for (const file of [
  "release/win-unpacked/FeiCalendar.exe",
  `release/FeiCalendar-${version}-win-x64.exe`,
]) {
  const executable = NtExecutable.from(await readFile(file), {
    ignoreCert: true,
  });
  const resources = NtExecutableResource.from(executable);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  assert.ok(groups.length > 0, `${file} has no icon resources`);
  for (const group of groups) {
    const actual = group
      .getIconItemsFromEntries(resources.entries)
      .map(iconHash)
      .sort();
    assert.deepEqual(actual, expected, `${file} has a different icon`);
  }
  console.log(`${file} — ${expected.length} icon sizes match build/icon.ico`);
}
