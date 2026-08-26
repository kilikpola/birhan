// SPDX-FileCopyrightText: 2026 Abenezer Wesenseged <wseged@proton.me>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as Controls
import org.kde.kirigami as Kirigami
import org.kde.kitemmodels as KitModels

ColumnLayout {
    id: testimonial
    property string title: ""
    property var testModel
    property var buttonWidth
    spacing: 10
    Layout.alignment: Qt.AlignTop

    KitModels.KSortFilterProxyModel {
        id: filteredModel
        sourceModel: testimonial.testModel
        filterRoleName: "bookName"
        filterRegularExpression: {
            if (searchField.text === "")
                return new RegExp();
            return new RegExp("%1".arg(searchField.text), "i");
        }
    }

    Kirigami.Heading {
        level: 1
        text: testimonial.title
        Layout.alignment: Qt.AlignHCenter
    }

    Kirigami.SearchField {
        id: searchField
        Layout.topMargin: Kirigami.Units.smallSpacing
        Layout.bottomMargin: Kirigami.Units.smallSpacing
        implicitHeight: 36
        Layout.fillWidth: true
    }

    Item {
        implicitHeight: testListView.contentHeight
        Layout.fillWidth: true

        ListView {
            id: testListView
            anchors.fill: parent
            model: filteredModel
            spacing: 6
            interactive: false
            clip: true

            delegate: Controls.Button {
                id: customButton
                text: bookName
                width: testListView.width
                height: 44
                background: Rectangle {
                    color: customButton.hovered ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.backgroundColor
                    radius: 4
                }

                contentItem: Text {
                    id: buttonText
                    text: customButton.text
                    anchors.centerIn: parent
                    font.pointSize: 12

                    color: customButton.hovered ? "white" : Kirigami.Theme.negativeTextColor

                    leftPadding: 20
                    horizontalAlignment: Text.AlignLeft
                    verticalAlignment: Text.AlignVCenter

                    Behavior on color {
                        ColorAnimation {
                            duration: 150
                        }
                    }
                }

                onClicked: applicationWindow().pageStack.push(Qt.resolvedUrl("BookPage.qml"), {
                    bookName: bookName,
                    chapterCount: chapterCount,
                    dataFile: dataFile
                })
            }
        }
    }
}
