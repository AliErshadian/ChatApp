export async function downloadMedia(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Download failed');

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(blobUrl);
}
