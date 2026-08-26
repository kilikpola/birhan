// SPDX-FileCopyrightText: 2026 Abenezer Wesenseged <wseged@proton.me>
//
// SPDX-License-Identifier: GPL-3.0-or-later

#include <KAboutData>
#include <KIconTheme>
#include <KLocalizedContext>
#include <KLocalizedString>
#include <QApplication>
#include <QIcon>
#include <QQmlApplicationEngine>
#include <QQuickStyle>
#include <QtQml>

int main(int argc, char *argv[]) {
  KIconTheme::initTheme();
  QApplication app(argc, argv);
  KLocalizedString::setApplicationDomain("bible");
  QApplication::setOrganizationName(QStringLiteral("Wesenseged"));
  QApplication::setOrganizationDomain(QStringLiteral("wesen.vercel.app"));
  QApplication::setApplicationName(QStringLiteral("Amharic Bible"));
  QApplication::setDesktopFileName(
      QStringLiteral("io.github.wesenseged.Amharic-bible"));

  app.setWindowIcon(
      QIcon::fromTheme(QStringLiteral("io.github.wesenseged.Amharic-bible")));

  QApplication::setStyle(QStringLiteral("breeze"));
  if (qEnvironmentVariableIsEmpty("QT_QUICK_CONTROLS_STYLE")) {
    QQuickStyle::setStyle(QStringLiteral("org.kde.desktop"));
  }

  KAboutData aboutData(
      QStringLiteral("io.github.wesenseged.Amharic-bible"), // not "org.kde."
      i18n("Amharic Bible"), QStringLiteral("1.0"),
      i18n("Offline Amharic Bible Reader"), KAboutLicense::GPL_V3,
      i18n("© 2026 Wesenseged Community"));

  KAboutData::setApplicationData(aboutData);

  qmlRegisterSingletonType("org.wesen.about", 1, 0, "About",
                           [](QQmlEngine *engine, QJSEngine *) -> QJSValue {
                             return engine->toScriptValue(
                                 KAboutData::applicationData());
                           });

  QQmlApplicationEngine engine;

  qputenv("QML_XHR_ALLOW_FILE_READ", "1");
  engine.rootContext()->setContextObject(new KLocalizedContext(&engine));
  engine.addImportPath(QStringLiteral("/usr/lib64/qt6/qml"));
  engine.loadFromModule("io.github.wesenseged.Amharic-bible", "Main");

  if (engine.rootObjects().isEmpty())
    return -1;

  return app.exec();
}
