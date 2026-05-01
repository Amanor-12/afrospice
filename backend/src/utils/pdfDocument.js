function escapePdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(value, maxCharacters = 92) {
  const words = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (!words.length) {
    return [""];
  }

  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxCharacters) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    if (word.length > maxCharacters) {
      let remaining = word;
      while (remaining.length > maxCharacters) {
        lines.push(remaining.slice(0, maxCharacters));
        remaining = remaining.slice(maxCharacters);
      }
      currentLine = remaining;
    } else {
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function buildSimplePdfBuffer({ title = "Document", subtitle = "", lines = [] } = {}) {
  const normalizedLines = [
    ...wrapText(title, 68),
    ...(subtitle ? ["", ...wrapText(subtitle, 88)] : []),
    "",
    ...lines.flatMap((line) => wrapText(line, 92)),
  ];

  const pageHeight = 792;
  const startY = 760;
  const lineHeight = 14;
  const contentLines = [];

  contentLines.push("BT");
  contentLines.push("/F1 16 Tf");
  contentLines.push(`50 ${pageHeight - 44} Td`);
  contentLines.push(`(${escapePdfText(title)}) Tj`);

  if (subtitle) {
    contentLines.push("0 -22 Td");
    contentLines.push("/F1 10 Tf");
    contentLines.push(`(${escapePdfText(subtitle)}) Tj`);
  } else {
    contentLines.push("/F1 10 Tf");
  }

  let textStarted = false;
  let currentY = startY - (subtitle ? 44 : 22);

  normalizedLines.slice(subtitle ? 4 : 3).forEach((line) => {
    if (!textStarted) {
      contentLines.push(`50 ${currentY} Td`);
      textStarted = true;
    } else {
      contentLines.push(`0 -${lineHeight} Td`);
      currentY -= lineHeight;
    }

    contentLines.push(`(${escapePdfText(line)}) Tj`);
  });

  contentLines.push("ET");

  const stream = contentLines.join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${object}\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

module.exports = {
  buildSimplePdfBuffer,
};
