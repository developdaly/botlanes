export function generateBoardHTML(basePath: string = ''): string {
  const bp = basePath.replace(/\/+$/, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Mission Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="${bp}/public/style.css">
</head>
<body>
  <div id="app"></div>
  <script>window.MC_BASE_PATH = "${bp}";</script>
  <script type="module" src="${bp}/public/app.js"></script>
</body>
</html>`;
}
