import Foundation

/// A crew member as shown in the UI - either from OpenAirLog directly, or
/// reconciled from an uploaded PDF crew list (see CrewMerge).
struct CrewMember: Identifiable, Equatable, Hashable {
    var id: String { role + "|" + name }
    let name: String
    let role: String
}

/// True if the string contains both upper- and lowercase letters (i.e. it's
/// already "properly" cased and shouldn't be re-title-cased).
func hasMixedCase(_ s: String) -> Bool {
    let hasLower = s.rangeOfCharacter(from: .lowercaseLetters) != nil
    let hasUpper = s.rangeOfCharacter(from: .uppercaseLetters) != nil
    return hasLower && hasUpper
}

/// Capitalizes the first letter after the start of the string and after
/// any space, hyphen, apostrophe or period - e.g. "MUELLER, ANNA-LENA" ->
/// "Mueller, Anna-Lena". Mirrors the web app's toTitleCase().
func toTitleCase(_ s: String) -> String {
    let lower = s.lowercased()
    var result = ""
    var capitalizeNext = true
    for ch in lower {
        if capitalizeNext, ch.isLetter {
            result.append(Character(ch.uppercased()))
            capitalizeNext = false
        } else {
            result.append(ch)
            capitalizeNext = (ch == " " || ch == "-" || ch == "'" || ch == ".")
        }
    }
    return result
}

/// ALL-CAPS PDF text (typical for crew rosters) gets nicely title-cased;
/// anything already mixed-case is left alone.
func displayName(_ s: String) -> String {
    hasMixedCase(s) ? s : toTitleCase(s)
}
