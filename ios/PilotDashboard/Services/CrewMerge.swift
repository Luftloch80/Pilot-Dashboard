import Foundation

/// A crew row as parsed from an uploaded PDF (see PDFCrewParser).
struct ParsedCrewMember: Equatable {
    let role: String
    let name: String
}

enum CrewMerge {
    /// OpenAirLog partly anonymizes crew (colleagues show as "H., Nicolas"
    /// - initial + full first name, only "is_self" gets a full surname),
    /// so the first name is the one part reliably comparable between
    /// OpenAirLog and a PDF's full names.
    static func firstName(of name: String) -> String {
        if let commaIdx = name.firstIndex(of: ",") {
            return String(name[name.index(after: commaIdx)...]).trimmingCharacters(in: .whitespaces).lowercased()
        }
        return name.trimmingCharacters(in: .whitespaces).lowercased()
    }

    /// Full-name match first (works when typed exactly as in the PDF),
    /// falling back to first-name-only comparison.
    static func isOwnName(_ memberName: String, _ ownName: String) -> Bool {
        guard !ownName.isEmpty else { return false }
        let a = memberName.trimmingCharacters(in: .whitespaces).lowercased()
        let b = ownName.trimmingCharacters(in: .whitespaces).lowercased()
        if a == b { return true }
        let fa = firstName(of: memberName)
        return !fa.isEmpty && fa == firstName(of: ownName)
    }

    /// True if there's nothing to compare against, or the PDF crew shares
    /// at least one first name with the known OpenAirLog crew - false only
    /// when both have data and share *no* names at all (i.e. the PDF is
    /// very likely for a different/stale rotation).
    static func crewListsPlausiblyMatch(pdfCrew: [ParsedCrewMember], apiFirstNames: Set<String>) -> Bool {
        guard !apiFirstNames.isEmpty else { return true }
        return pdfCrew.contains { apiFirstNames.contains(firstName(of: $0.name)) }
    }

    /// The PDF crew list is a snapshot that can go stale mid-trip (a late
    /// crew swap) - OpenAirLog stays the live source of truth. For each
    /// OpenAirLog crew member, use the PDF's nicer full name only if the
    /// same role's first name still matches; a role whose occupant has
    /// since changed falls back to OpenAirLog's own name for that entry.
    static func mergeCrewWithPdf(apiCrew: [CrewMember], pdfCrew: [ParsedCrewMember]) -> [CrewMember] {
        apiCrew.map { member in
            if let match = pdfCrew.first(where: {
                $0.role.uppercased() == member.role.uppercased() &&
                firstName(of: $0.name) == firstName(of: member.name)
            }) {
                return CrewMember(name: match.name, role: member.role)
            }
            return member
        }
    }
}
