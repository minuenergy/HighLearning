import Foundation
import Vision
import CoreGraphics
import ImageIO

struct OCRResult: Codable {
    let path: String
    let text: String
    let error: String?
}

func loadPaths(from inputList: String) throws -> [String] {
    let content = try String(contentsOfFile: inputList, encoding: .utf8)
    return content
        .split(separator: "\n")
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
}

func cgImage(from path: String) throws -> CGImage {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
        throw NSError(domain: "VisionOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "이미지 소스를 열 수 없습니다: \(path)"])
    }
    guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "VisionOCR", code: 2, userInfo: [NSLocalizedDescriptionKey: "CGImage 생성에 실패했습니다: \(path)"])
    }
    return image
}

func recognizeText(path: String, languages: [String], recognitionLevel: VNRequestTextRecognitionLevel) -> OCRResult {
    do {
        let image = try cgImage(from: path)
        var recognizedLines: [String] = []

        let request = VNRecognizeTextRequest { request, error in
            if let error = error {
                recognizedLines = ["__ERROR__\(error.localizedDescription)"]
                return
            }

            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                return
            }

            for observation in observations {
                if let candidate = observation.topCandidates(1).first {
                    let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty {
                        recognizedLines.append(text)
                    }
                }
            }
        }

        request.recognitionLevel = recognitionLevel
        request.usesLanguageCorrection = true
        request.recognitionLanguages = languages
        request.minimumTextHeight = 0.0

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])

        if let first = recognizedLines.first, first.hasPrefix("__ERROR__") {
            return OCRResult(path: path, text: "", error: String(first.dropFirst("__ERROR__".count)))
        }

        return OCRResult(path: path, text: recognizedLines.joined(separator: "\n"), error: nil)
    } catch {
        return OCRResult(path: path, text: "", error: error.localizedDescription)
    }
}

func printUsage() {
    FileHandle.standardError.write(Data("Usage: vision_ocr --input-list <file> [--langs ko-KR,en-US] [--fast]\n".utf8))
}

let arguments = CommandLine.arguments
var inputList: String?
var langsArg = "ko-KR,en-US"
var fast = false

var index = 1
while index < arguments.count {
    let arg = arguments[index]
    switch arg {
    case "--input-list":
        index += 1
        if index < arguments.count {
            inputList = arguments[index]
        }
    case "--langs":
        index += 1
        if index < arguments.count {
            langsArg = arguments[index]
        }
    case "--fast":
        fast = true
    default:
        break
    }
    index += 1
}

guard let inputList else {
    printUsage()
    exit(2)
}

let recognitionLevel: VNRequestTextRecognitionLevel = fast ? .fast : .accurate
let languages = langsArg
    .split(separator: ",")
    .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }

do {
    let paths = try loadPaths(from: inputList)
    let encoder = JSONEncoder()
    encoder.outputFormatting = []

    for path in paths {
        let result = recognizeText(path: path, languages: languages, recognitionLevel: recognitionLevel)
        let data = try encoder.encode(result)
        if let line = String(data: data, encoding: .utf8) {
            print(line)
        }
    }
} catch {
    FileHandle.standardError.write(Data("vision_ocr error: \(error.localizedDescription)\n".utf8))
    exit(1)
}
