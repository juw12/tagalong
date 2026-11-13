// Read the text in a screenshot with the Vision framework that ships with macOS.
// swift tests/device/ocr.swift <image.png>   prints one recognised line per row.
import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("usage: ocr.swift <image>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url),
      let picture = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot read the image\n".data(using: .utf8)!)
    exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
do {
    try VNImageRequestHandler(cgImage: picture, options: [:]).perform([request])
} catch {
    FileHandle.standardError.write("text recognition failed: \(error)\n".data(using: .utf8)!)
    exit(3)
}
for observation in request.results ?? [] {
    if let best = observation.topCandidates(1).first {
        print(best.string)
    }
}
