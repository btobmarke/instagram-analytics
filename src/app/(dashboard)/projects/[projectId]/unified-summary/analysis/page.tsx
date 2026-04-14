export const dynamic = 'force-dynamic'

import { SummaryCardsAnalysisClient } from './_components/SummaryCardsAnalysisClient'

export default async function UnifiedSummaryAnalysisPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return (
    <SummaryCardsAnalysisClient projectId={projectId} />
  )
}

