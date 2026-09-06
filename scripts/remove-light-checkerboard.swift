import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else {
  fputs("usage: remove-light-checkerboard.swift input.png output.png\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard inputURL.standardizedFileURL != outputURL.standardizedFileURL,
      !FileManager.default.fileExists(atPath: outputURL.path) else {
  fputs("output must be a new file, original assets are preserved\n", stderr)
  exit(2)
}

guard
  let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  fputs("unable to decode input image\n", stderr)
  exit(3)
}

let width = image.width
let height = image.height
let bytesPerPixel = 4
let bytesPerRow = width * bytesPerPixel
var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)

guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
  fputs("unable to create sRGB color space\n", stderr)
  exit(4)
}

guard let context = CGContext(
  data: &pixels,
  width: width,
  height: height,
  bitsPerComponent: 8,
  bytesPerRow: bytesPerRow,
  space: colorSpace,
  bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
) else {
  fputs("unable to create bitmap context\n", stderr)
  exit(5)
}

context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

if ProcessInfo.processInfo.environment["PIXEL_OPS_BG_DEBUG"] == "1" {
  for (x, y) in [(0, 0), (153, 100), (150, 150), (128, 128)] {
    guard x < width, y < height else { continue }
    let offset = (y * width + x) * bytesPerPixel
    print("sample \(x),\(y): \(Array(pixels[offset..<(offset + bytesPerPixel)]))")
  }
}

func isChromaMagenta(_ offset: Int) -> Bool {
  let red = Int(pixels[offset])
  let green = Int(pixels[offset + 1])
  let blue = Int(pixels[offset + 2])
  return red >= 110 && blue >= 95 && green * 2 < min(red, blue)
}

func isBackgroundColor(_ offset: Int) -> Bool {
  let red = Int(pixels[offset])
  let green = Int(pixels[offset + 1])
  let blue = Int(pixels[offset + 2])
  let lightNeutral = min(red, green, blue) >= 238
    && max(red, green, blue) - min(red, green, blue) <= 5
  return lightNeutral || isChromaMagenta(offset)
}

var visited = [Bool](repeating: false, count: width * height)
var queue = [Int]()
queue.reserveCapacity(width * height / 2)

func enqueue(_ x: Int, _ y: Int) {
  guard x >= 0, x < width, y >= 0, y < height else { return }
  let index = y * width + x
  guard !visited[index], isBackgroundColor(index * bytesPerPixel) else { return }
  visited[index] = true
  queue.append(index)
}

for x in 0..<width {
  enqueue(x, 0)
  enqueue(x, height - 1)
}
for y in 0..<height {
  enqueue(0, y)
  enqueue(width - 1, y)
}

var cursor = 0
while cursor < queue.count {
  let index = queue[cursor]
  cursor += 1
  let x = index % width
  let y = index / width
  enqueue(x - 1, y)
  enqueue(x + 1, y)
  enqueue(x, y - 1)
  enqueue(x, y + 1)
}

for index in 0..<(width * height) {
  let offset = index * bytesPerPixel
  guard visited[index] else { continue }
  pixels[offset] = 0
  pixels[offset + 1] = 0
  pixels[offset + 2] = 0
  pixels[offset + 3] = 0
}

guard let outputImage = context.makeImage() else {
  fputs("unable to create output image\n", stderr)
  exit(6)
}

guard let destination = CGImageDestinationCreateWithURL(
  outputURL as CFURL,
  UTType.png.identifier as CFString,
  1,
  nil
) else {
  fputs("unable to create PNG destination\n", stderr)
  exit(7)
}

CGImageDestinationAddImage(destination, outputImage, nil)
guard CGImageDestinationFinalize(destination) else {
  fputs("unable to write output PNG\n", stderr)
  exit(8)
}

print("removed \(queue.count) connected background pixels from \(width)x\(height) atlas")
