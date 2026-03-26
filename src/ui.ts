export function generateBoardHTML(basePath: string = ''): string {
  const bp = basePath.replace(/\/+$/, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mission Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/style.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/style.css">
  <link rel="stylesheet" href="${bp}/public/style.css">
</head>
<body>
  <div id="app"></div>
  <script>window.MC_BASE_PATH = "${bp}";</script>
  <script type="module" src="${bp}/public/app.js"></script>
</body>
</html>`;
}
