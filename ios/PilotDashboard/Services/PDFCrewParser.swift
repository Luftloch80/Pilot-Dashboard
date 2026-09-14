import Foundation
import PDFKit

/// Parses an uploaded Umlaufcrewliste PDF. Unlike the web app (which uses
/// pdf.js's individual positioned text fragments, clustered by y-coordinate
/// into rows), this uses PDFKit's own per-page text extraction - simpler,
/// and works well for straightforward single-column crew rosters, but may
/// not preserve row order as reliably on a complex multi-column layout.
/// If crew rows aren't detected, nothing is overwritten (see
/// DashboardViewModel) - same "don't guess" fallback as the web version.
enum PDFCrewParser {

    static func extractLines(from document: PDFDocument) -> [String] {
        var lines: [String] = []
        for i in 0..<document.pageCount {
            guard let page = document.page(at: i), let text = page.string else { continue }
            lines.append(contentsOf: text.components(separatedBy: .newlines))
        }
        return lines.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    // Role: 1-3 letters/digits (e.g. CP/FO/P1/FB), then "NACHNAME, VORNAME"
    // (upper or mixed case), optionally followed by a staff-ID token - the
    // ID is used as an anchor so the name group can't run on too far.
    private static let crewRowWithID = try! NSRegularExpression(
        pattern: #"^([A-Z][A-Z0-9]{0,2})\s+([A-ZÄÖÜß][A-ZÄÖÜß\-]*,\s*[A-ZÄÖÜß][A-ZÄÖÜß\- ]*?)\s+(\d\S*)\s*(.*)$"#,
        options: [.caseInsensitive]
    )
    private static let crewRowNoID = try! NSRegularExpression(
        pattern: #"^([A-Z][A-Z0-9]{0,2})\s+([A-ZÄÖÜß][A-ZÄÖÜß\-]*,\s*[A-ZÄÖÜß][A-ZÄÖÜß\- ]*)$"#,
        options: [.caseInsensitive]
    )

    static func parseCrew(from lines: [String]) -> [ParsedCrewMember] {
        var crew: [ParsedCrewMember] = []
        for line in lines {
            let range = NSRange(line.startIndex..., in: line)
            if let m = crewRowWithID.firstMatch(in: line, range: range), m.numberOfRanges >= 3 {
                let role = substring(line, m.range(at: 1)).trimmingCharacters(in: .whitespaces)
                let name = substring(line, m.range(at: 2)).trimmingCharacters(in: .whitespaces)
                crew.append(ParsedCrewMember(role: role, name: displayName(collapseSpaces(name))))
                continue
            }
            if let m = crewRowNoID.firstMatch(in: line, range: range), m.numberOfRanges >= 3 {
                let role = substring(line, m.range(at: 1)).trimmingCharacters(in: .whitespaces)
                let name = substring(line, m.range(at: 2)).trimmingCharacters(in: .whitespaces)
                crew.append(ParsedCrewMember(role: role, name: displayName(collapseSpaces(name))))
            }
        }
        return crew
    }

    /// "PU 4:20" (the confirmed real-world abbreviation) first, since it
    /// directly gives an unambiguous clock time; falls back to a spelled-out
    /// "Pickup"/"Abholung" mention with best-effort time extraction.
    static func findPickupLocal(in lines: [String]) -> String? {
        let puRegex = try! NSRegularExpression(pattern: #"\bPU\b\s*(\d{1,2}):(\d{2})\b"#)
        for line in lines {
            let range = NSRange(line.startIndex..., in: line)
            if let m = puRegex.firstMatch(in: line, range: range), m.numberOfRanges >= 3 {
                let hh = substring(line, m.range(at: 1))
                let mm = substring(line, m.range(at: 2))
                return "\(pad(hh)):\(mm) LT"
            }
        }

        let mentionRegex = try! NSRegularExpression(pattern: "pick[- ]?up|abholung", options: [.caseInsensitive])
        let timeRegex = try! NSRegularExpression(pattern: #"\b(\d{1,2}):(\d{2})\b"#)
        for line in lines {
            let fullRange = NSRange(line.startIndex..., in: line)
            guard mentionRegex.firstMatch(in: line, range: fullRange) != nil else { continue }
            if let m = timeRegex.firstMatch(in: line, range: fullRange), m.numberOfRanges >= 3 {
                let hh = substring(line, m.range(at: 1))
                let mm = substring(line, m.range(at: 2))
                return "\(pad(hh)):\(mm) LT"
            }
            return line
        }
        return nil
    }

    private static func pad(_ s: String) -> String { s.count == 1 ? "0" + s : s }
    private static func collapseSpaces(_ s: String) -> String {
        s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }
    private static func substring(_ s: String, _ range: NSRange) -> String {
        guard let r = Range(range, in: s) else { return "" }
        return String(s[r])
    }
}
