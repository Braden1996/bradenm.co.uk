import AppKit
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import Vision

guard CommandLine.arguments.count == 3 else {
  fputs("usage: foreground-mask input output\n", stderr)
  exit(64)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard
  let image = NSImage(contentsOf: inputURL),
  let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
  fputs("could not decode input image\n", stderr)
  exit(65)
}

let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up)
let request = VNGenerateForegroundInstanceMaskRequest()

do {
  try handler.perform([request])

  guard let observation = request.results?.first else {
    fputs("no foreground observation\n", stderr)
    exit(66)
  }

  let pixelBuffer = try observation.generateScaledMaskForImage(
    forInstances: observation.allInstances,
    from: handler
  )
  let mask = CIImage(cvPixelBuffer: pixelBuffer)
  let context = CIContext(options: [.useSoftwareRenderer: false])
  let colorSpace = CGColorSpaceCreateDeviceGray()

  guard
    let destination = CGImageDestinationCreateWithURL(
      outputURL as CFURL,
      UTType.png.identifier as CFString,
      1,
      nil
    ),
    let rendered = context.createCGImage(mask, from: mask.extent, format: .L8, colorSpace: colorSpace)
  else {
    fputs("could not create output image\n", stderr)
    exit(67)
  }

  CGImageDestinationAddImage(destination, rendered, nil)

  guard CGImageDestinationFinalize(destination) else {
    fputs("could not write output image\n", stderr)
    exit(68)
  }
} catch {
  fputs("mask generation failed: \(error)\n", stderr)
  exit(69)
}
