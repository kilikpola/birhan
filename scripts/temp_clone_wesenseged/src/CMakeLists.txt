add_executable(amharic-bible
)

ecm_add_qml_module(amharic-bible
    URI 
    io.github.wesenseged.Amharic-bible
)
target_sources(amharic-bible
    PRIVATE
    main.cpp
)

ecm_target_qml_sources(amharic-bible
    SOURCES
      qml/Main.qml
      qml/pages/WelcomePage.qml
      qml/pages/BookPage.qml
      qml/pages/AboutPage.qml
      qml/header/DefaultHeader.qml
      qml/components/Testimonial.qml
)

qt_add_resources(amharic-bible "resources"
    PREFIX /
    FILES
        data/books.json

        data/genesis.json
        data/exodus.json
        data/leviticus.json
        data/numbers.json
        data/deuteronomy.json
        data/joshua.json
        data/judges.json
        data/ruth.json
        data/1samuel.json
        data/2samuel.json
        data/1kings.json
        data/2kings.json
        data/1chronicles.json
        data/2chronicles.json
        data/ezra.json
        data/nehemiah.json
        data/esther.json
        data/job.json
        data/psalms.json
        data/proverbs.json
        data/ecclesiastes.json
        data/songofsolomon.json
        data/isaiah.json
        data/jeremiah.json
        data/lamentations.json
        data/ezekiel.json
        data/daniel.json
        data/hoshea.json
        data/joel.json
        data/amos.json
        data/obadiah.json
        data/jonah.json
        data/micah.json
        data/nahum.json
        data/habakkuk.json
        data/zephaniah.json
        data/haggai.json
        data/zechariah.json
        data/malachi.json
        
        data/matthew.json
        data/mark.json
        data/luke.json
        data/john.json
        data/acts.json
        data/romans.json
        data/1corinthians.json
        data/2corinthians.json
        data/galatians.json
        data/ephesians.json
        data/philippians.json
        data/colossians.json
        data/1thessalonians.json
        data/2thessalonians.json
        data/1timothy.json
        data/2timothy.json
        data/titus.json
        data/philemon.json
        data/hebrews.json
        data/james.json
        data/1peter.json
        data/2peter.json
        data/1john.json
        data/2john.json
        data/3john.json
        data/jude.json
        data/revelation.json
)


target_link_libraries(amharic-bible
    PRIVATE
    Qt6::Quick
    Qt6::Qml
    Qt6::Gui
    Qt6::QuickControls2
    Qt6::Widgets
    KF6::I18n
    KF6::CoreAddons
    KF6::IconThemes
    KF6::ItemModels
    KF6::CoreAddons
)

install(TARGETS amharic-bible ${KDE_INSTALL_TARGETS_DEFAULT_ARGS})
install(DIRECTORY qml/ DESTINATION ${KDE_INSTALL_QMLDIR}/io/github/wesenseged/Amharic-bible)
