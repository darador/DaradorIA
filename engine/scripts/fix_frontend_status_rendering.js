const fs = require('fs');
const path = require('path');

function updateFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Fix mobileListContainer statusBadge
  const oldBadgePattern = /const isApproved = pick\.status === 'APROBADO';\s*const statusBadge = isApproved\s*\?\s*'<span class="status-pill approved">✔ APROBADO<\/span>'\s*:\s*'<span class="status-pill pending">🕒 PENDIENTE<\/span>';/;
  if (oldBadgePattern.test(content)) {
    content = content.replace(oldBadgePattern, 'const statusBadge = getStatusBadge(pick.status);');
    console.log(`✅ Fixed mobileListContainer statusBadge in ${fileName}`);
  } else {
    console.warn(`⚠️ mobileListContainer pattern not matched in ${fileName}`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

updateFile('dashboard.html');
updateFile('index.html');
