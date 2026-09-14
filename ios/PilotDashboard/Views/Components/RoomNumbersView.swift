import SwiftUI

/// Own + crew room numbers for the current layover, keyed per
/// arrCode(+hotel, unknown natively so left blank)(+name for crew).
struct RoomNumbersView: View {
    @ObservedObject var viewModel: DashboardViewModel
    let arrCode: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Zimmernummern").font(.subheadline.bold())

            roomField(title: "Ich", key: viewModel.roomKey(arrCode: arrCode, hotel: nil))

            ForEach(viewModel.currentCrew) { member in
                roomField(
                    title: "\(member.role) \(member.name)",
                    key: viewModel.crewRoomKey(arrCode: arrCode, hotel: nil, name: member.name)
                )
            }
        }
    }

    private func roomField(title: String, key: String) -> some View {
        HStack {
            Text(title).font(.footnote).foregroundStyle(Theme.textMuted)
            Spacer()
            TextField("Zimmer", text: Binding(
                get: { viewModel.getRoomNumber(key) },
                set: { viewModel.setRoomNumber(key, $0) }
            ))
            .multilineTextAlignment(.trailing)
            .keyboardType(.default)
            .frame(width: 100)
            .textFieldStyle(.roundedBorder)
        }
    }
}
