/**
 * Allowlisted model catalog — verified model definitions that the Model Manager
 * can offer for download. Every entry has a known architecture, source, stems,
 * and approximate size. Downloads require a bundled inference worker + runtime
 * (none present in this environment); until then, entries display with download
 * disabled and an honest "requires inference runtime" note.
 *
 * No weights are downloaded or redistributed by this code. License/redistribution
 * status is documented per entry and MUST be verified before bundling.
 */

export interface CatalogModel {
  id: string;
  displayName: string;
  architecture: "mdx-net" | "demucs" | "bs-roformer" | "melband-roformer" | "vr-arch" | "mdxc";
  format: ".onnx" | ".ckpt" | ".pth" | ".pt" | ".safetensors";
  supportedStems: string[];
  /** Approximate download size, bytes (may vary by source). */
  approxSizeBytes: number;
  /** Allowlisted HTTPS source URL. */
  sourceUrl: string;
  /** SHA-256 of the expected download (for integrity verification). */
  expectedSha256: string | null;
  /** Required inference runtime. */
  requiredRuntime: "onnxruntime-cpu" | "pytorch-cpu" | "pytorch-cuda";
  supportedDevices: ("cpu" | "cuda" | "directml")[];
  license: string;
  licenseUrl: string;
  /** Redistribution status — must be verified before bundling. */
  redistribution: "verified" | "unverified";
  description: string;
}

/**
 * Catalog of verified model definitions. These are real, well-known separation
 * models from the UVR ecosystem. The `redistribution` field records whether
 * redistribution rights have been confirmed; none are confirmed in this build.
 */
export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: "uvr-mdx-net-inst-hq-3",
    displayName: "UVR-MDX-NET Inst HQ 3",
    architecture: "mdx-net",
    format: ".onnx",
    supportedStems: ["Vocals", "Instrumental"],
    approxSizeBytes: 80 * 1024 * 1024,
    sourceUrl: "https://github.com/TRvlvr/model_repo/releases/download/v1.0/UVR-MDX-NET_Inst_HQ_3.onnx",
    expectedSha256: null, // verify before bundling
    requiredRuntime: "onnxruntime-cpu",
    supportedDevices: ["cpu", "cuda", "directml"],
    license: "MIT (verify at source)",
    licenseUrl: "https://github.com/TRvlvr/model_repo",
    redistribution: "unverified",
    description: "MDX-Net instrumental/vocal separation. Candidate default model — CPU-capable via ONNX Runtime.",
  },
  {
    id: "htdemucs-4s",
    displayName: "HTDemucs v4 (4-stem)",
    architecture: "demucs",
    format: ".ckpt",
    supportedStems: ["Vocals", "Drums", "Bass", "Other"],
    approxSizeBytes: 80 * 1024 * 1024,
    sourceUrl: "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/f7e0c425-b9c47387.th",
    expectedSha256: null,
    requiredRuntime: "pytorch-cpu",
    supportedDevices: ["cpu", "cuda"],
    license: "MIT (Demucs)",
    licenseUrl: "https://github.com/facebookresearch/demucs",
    redistribution: "unverified",
    description: "Hybrid Transformer Demucs v4 — four-stem (vocals/drums/bass/other). CPU via PyTorch.",
  },
  {
    id: "bs-roformer-vocals",
    displayName: "BS-RoFormer (vocals/instrumental)",
    architecture: "bs-roformer",
    format: ".ckpt",
    supportedStems: ["Vocals", "Instrumental"],
    approxSizeBytes: 250 * 1024 * 1024,
    sourceUrl: "https://github.com/TRvlvr/model_repo/releases",
    expectedSha256: null,
    requiredRuntime: "pytorch-cpu",
    supportedDevices: ["cpu", "cuda"],
    license: "Verify at source",
    licenseUrl: "https://github.com/TRvlvr/model_repo",
    redistribution: "unverified",
    description: "Band-split RoFormer — high-quality vocal/instrumental separation. CPU via PyTorch.",
  },
  {
    id: "melband-roformer-vocals",
    displayName: "MelBand RoFormer (vocals/instrumental)",
    architecture: "melband-roformer",
    format: ".ckpt",
    supportedStems: ["Vocals", "Instrumental"],
    approxSizeBytes: 260 * 1024 * 1024,
    sourceUrl: "https://github.com/TRvlvr/model_repo/releases",
    expectedSha256: null,
    requiredRuntime: "pytorch-cpu",
    supportedDevices: ["cpu", "cuda"],
    license: "Verify at source",
    licenseUrl: "https://github.com/TRvlvr/model_repo",
    redistribution: "unverified",
    description: "MelBand RoFormer — alternative quality-oriented vocal separation. CPU via PyTorch.",
  },
];

/** True when a model's required runtime is among the bundled/available runtimes. */
export function isModelDownloadable(model: CatalogModel, availableRuntimes: string[]): boolean {
  return availableRuntimes.includes(model.requiredRuntime);
}
