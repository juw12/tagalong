// Read the text in a screenshot with the Vision framework that ships with macOS.
// swift tests/device/ocr.swift <image.png>           prints one recognised line per row.
// swift tests/device/ocr.swift --boxes <image.png>   prints top, bottom, left (pixels from the top-left) and the text, tab separated.
import AppKit
import Foundation
import Vision

let arguments = Array(CommandLine.arguments.dropFirst())
let showBoxes = arguments.contains("--boxes")
let paths = arguments.filter { !$0.hasPrefix("--") }
guard let path = paths.first else {
    FileHandle.standardError.write("usage: ocr.swift [--boxes] <image>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: path)
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
let pixelWidth = Double(picture.width)
let pixelHeight = Double(picture.height)
for observation in request.results ?? [] {
    if let best = observation.topCandidates(1).first {
        if showBoxes {
            // Vision boxes are fractions of the image measured from the bottom-left corner.
            let box = observation.boundingBox
            let top = Int(((1.0 - Double(box.maxY)) * pixelHeight).rounded())
            let bottom = Int(((1.0 - Double(box.minY)) * pixelHeight).rounded())
            let left = Int((Double(box.minX) * pixelWidth).rounded())
            print("\(top)\t\(bottom)\t\(left)\t\(best.string)")
        } else {
            print(best.string)
        }
    }
}
