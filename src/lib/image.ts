const SIZE = 256;

/** Límite del archivo original: se recorta y reduce en el navegador antes de subirlo. */
export const MAX_IMAGE_INPUT_BYTES = 15 * 1024 * 1024;

/** Recorta al centro en cuadrado y reduce a 256 px (WEBP): la imagen pesa poco y el origen se limpia. */
export async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("blob"))), "image/webp", 0.85));
}
