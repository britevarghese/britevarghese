// After electron-builder lays the app out and before it makes the installer: put TRAILBREAK's icon and name into the
// .exe (its version resource). electron-builder does this with rcedit, which on Linux needs Wine; resedit does it in
// plain JavaScript, the same on any machine (package.json: signAndEditExecutable false).
'use strict';
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const app = ctx.packager.appInfo;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.platformSpecificBuildOptions.executableName || app.productFilename}.exe`);
  const pe = R.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = R.NtExecutableResource.from(pe);
  // the icon: replace the Electron one (its group's id) with ours, at every size the .ico has
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const id = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map((i) => i.data));
  // the version resource: the name and version Windows shows in the file's properties and the task manager
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0] || R.Resource.VersionInfo.createEmpty();
  const [a, b, c] = app.version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: app.productName, FileDescription: app.productName, CompanyName: app.companyName || app.productName,
    LegalCopyright: app.copyright || '', OriginalFilename: path.basename(exe), InternalName: app.productName,
    FileVersion: app.version, ProductVersion: app.version,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log(`  • TRAILBREAK icon and version ${app.version} put into ${path.basename(exe)}`);
};
