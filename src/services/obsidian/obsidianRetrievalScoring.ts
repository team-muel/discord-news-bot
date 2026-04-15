import {
  buildDocumentIdentitySet,
  normalizeMetadataReference,
  readFrontmatterString,
  readFrontmatterStringArray,
  readFrontmatterTimestamp,
} from './obsidianMetadataUtils';

export type RetrievedDocumentCandidate = {
  filePath: string;
  score: number;
};

type ObsidianRetrievedDocument = {
  content: string;
  frontmatter?: Record<string, any>;
};

export type RetrievalMetadataAssessment = {
  adjustments: Map<string, number>;
  summary: {
    activeDocs: number;
    invalidDocs: number;
    supersededDocs: number;
    sourcedDocs: number;
  };
};

export function assessRetrievalMetadata(
  documents: Map<string, ObsidianRetrievedDocument>,
): RetrievalMetadataAssessment {
  const now = Date.now();
  const adjustments = new Map<string, number>();
  const summary = {
    activeDocs: 0,
    invalidDocs: 0,
    supersededDocs: 0,
    sourcedDocs: 0,
  };
  const identities = new Map<string, Set<string>>();
  const supersededPaths = new Set<string>();

  for (const [filePath, document] of documents.entries()) {
    identities.set(filePath, buildDocumentIdentitySet(filePath, document.frontmatter));
  }

  for (const [filePath, document] of documents.entries()) {
    const supersedesRefs = readFrontmatterStringArray(document.frontmatter, 'supersedes')
      .map((entry) => normalizeMetadataReference(entry))
      .filter(Boolean);
    if (supersedesRefs.length === 0) {
      continue;
    }

    for (const [candidatePath, candidateIdentities] of identities.entries()) {
      if (candidatePath === filePath) {
        continue;
      }
      if (supersedesRefs.some((entry) => candidateIdentities.has(entry))) {
        supersededPaths.add(candidatePath);
      }
    }
  }

  for (const [filePath, document] of documents.entries()) {
    const frontmatter = document.frontmatter;
    const status = readFrontmatterString(frontmatter, 'status').toLowerCase();
    const invalidAt = readFrontmatterTimestamp(frontmatter, 'invalid_at');
    const validAt = readFrontmatterTimestamp(frontmatter, 'valid_at');
    const sourceRefs = readFrontmatterStringArray(frontmatter, 'source_refs');
    const supersedesRefs = readFrontmatterStringArray(frontmatter, 'supersedes');
    let adjustment = 0;

    if (status === 'active' || status === 'open' || status === 'answered') {
      adjustment += 0.08;
      summary.activeDocs += 1;
    }

    if (status === 'invalid' || status === 'superseded' || status === 'archived') {
      adjustment -= 0.9;
    }

    if (invalidAt && invalidAt <= now) {
      adjustment -= 1.1;
      summary.invalidDocs += 1;
    }

    if (validAt && validAt > now) {
      adjustment -= 0.35;
    }

    if (sourceRefs.length > 0) {
      adjustment += Math.min(0.18, Math.log2(1 + sourceRefs.length) * 0.08);
      summary.sourcedDocs += 1;
    }

    if (supersedesRefs.length > 0) {
      adjustment += 0.12;
    }

    if (supersededPaths.has(filePath)) {
      adjustment -= 0.8;
      summary.supersededDocs += 1;
    }

    adjustments.set(filePath, adjustment);
  }

  return { adjustments, summary };
}

export function rankDocumentsForRetrieval(params: {
  documents: Map<string, ObsidianRetrievedDocument>;
  candidates: RetrievedDocumentCandidate[];
  graphMetadata: Record<string, any>;
  metadataAdjustments: Map<string, number>;
  limit: number;
}): Map<string, ObsidianRetrievedDocument> {
  const candidateScores = new Map(params.candidates.map((candidate) => [candidate.filePath, candidate.score]));
  const rankedEntries = [...params.documents.entries()]
    .map(([filePath, document]) => {
      const graphMeta = params.graphMetadata[filePath];
      const backlinkCount = Array.isArray(graphMeta?.backlinks) ? graphMeta.backlinks.length : 0;
      const linkCount = Array.isArray(graphMeta?.links) ? graphMeta.links.length : 0;
      const connectivityBoost = Math.min(0.25, Math.log2(1 + backlinkCount + linkCount) * 0.04);
      const orphanPenalty = backlinkCount === 0 && linkCount === 0 ? -0.12 : 0;
      const score = (candidateScores.get(filePath) ?? 0)
        + connectivityBoost
        + orphanPenalty
        + (params.metadataAdjustments.get(filePath) ?? 0);
      return { filePath, document, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, params.limit);

  return new Map(rankedEntries.map((entry) => [entry.filePath, entry.document]));
}