export function generateBoardHTML(basePath: string = ''): string {
  const bp = basePath.replace(/\/+$/, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>botlanes</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&family=Rajdhani:wght@700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${bp}/public/style.css">
</head>
<body>
  <div id="app"></div>
  <script>window.BOTLANES_BASE_PATH = "${bp}";</script>
  <script type="module" src="${bp}/public/app.js"></script>
</body>
</html>`;
}
