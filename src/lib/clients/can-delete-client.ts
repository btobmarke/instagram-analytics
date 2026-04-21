/** クライアントを物理削除してよいか（紐づくプロジェクトが無いこと） */
export function canDeleteClient(projectCount: number): boolean {
  return projectCount === 0
}
