const path = require('path');
const fs = require('fs');

/**
 * Embed RELAY icon into the Windows .exe.
 * Needed because win.signAndEditExecutable is false (avoids winCodeSign symlink errors).
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(__dirname, 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] exe not found: ${exePath}`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] icon not found: ${iconPath}`);
    return;
  }

  const { rcedit } = require('rcedit');
  await rcedit(exePath, {
    icon: iconPath,
    'version-string': {
      CompanyName: 'RELAY',
      FileDescription: 'RELAY',
      ProductName: 'RELAY',
      InternalName: 'RELAY',
      OriginalFilename: exeName,
    },
  });
  console.log(`[afterPack] embedded icon into ${exeName}`);
};
