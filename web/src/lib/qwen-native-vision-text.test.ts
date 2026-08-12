import { describe, expect, it } from "vitest";
import {
  NATIVE_IMAGE_ANALYSIS_NOTICE,
  nativeImageContext,
  splitNativeImageAnalysis,
} from "./qwen-native-vision-text";

describe("splitNativeImageAnalysis", () => {
  it("splits a request from the injected analysis and drops the notice", () => {
    const text = nativeImageContext("タイトル生成の要因は？", "The image shows a status bar.");
    expect(splitNativeImageAnalysis(text)).toEqual({
      request: "タイトル生成の要因は？",
      analysis: "The image shows a status bar.",
    });
  });

  it("keeps plain user text untouched", () => {
    expect(splitNativeImageAnalysis("ただの質問")).toEqual({
      request: "ただの質問",
      analysis: "",
    });
  });

  it("uses the default request for image-only sends", () => {
    const split = splitNativeImageAnalysis(nativeImageContext("", "text"));
    expect(split.request).toBe("添付画像を確認し、内容を説明してください。");
    expect(split.analysis).toBe("text");
  });

  it("keeps the analysis intact when it echoes the wrapper tag", () => {
    // The VL model sees this UI in screenshots and can transcribe the tag.
    const echoed = "Visible text:\n<qwen-native-image-analysis>\nnested";
    const split = splitNativeImageAnalysis(nativeImageContext("見て", echoed));
    expect(split.request).toBe("見て");
    expect(split.analysis).toBe(echoed);
    expect(split.analysis).not.toContain(NATIVE_IMAGE_ANALYSIS_NOTICE);
  });

  it("ignores an unterminated block", () => {
    const text = "質問\n\n<qwen-native-image-analysis>\nhalf";
    expect(splitNativeImageAnalysis(text).analysis).toBe("");
  });

  it("falls back to the bare tag when the notice was reworded", () => {
    const text = "質問\n\n<qwen-native-image-analysis>\nold notice\nbody\n</qwen-native-image-analysis>";
    expect(splitNativeImageAnalysis(text)).toEqual({
      request: "質問",
      analysis: "old notice\nbody",
    });
  });
});
