export const uiText = {
  common: {
    later: 'Myöhemmin',
  },
  layout: {
    appMode: 'Paikallinen käyttöliittymä',
    collapseSidebar: 'Sulje päävalikko',
    companyNavigation: 'Yritys',
    currentRuntimeMode: 'Nykyinen ajotila',
    expandSidebar: 'Avaa päävalikko',
    localBackend: 'Paikallinen backend',
    modules: 'Moduulit',
    primaryNavigation: 'Päätoiminnot',
  },
  modules: {
    activity: 'Tapahtumat',
    diagnostics: 'Diagnostiikka',
    companySettings: 'Oma yritys',
    customers: 'Asiakkaat',
    sites: 'Kohteet',
    workOrders: 'Työmääräykset',
    invoicing: 'Laskutus',
  },
  activity: {
    customerNumber: 'Asiakas',
    empty: 'Tapahtumia ei ole vielä.',
    event: 'Tapahtuma',
    heading: 'Tapahtumat',
    invoiceNumber: 'Lasku',
    kicker: 'Historia',
    loadError: 'Tapahtumia ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    loading: 'Ladataan tapahtumia...',
    noReference: 'Oma yritys',
    occurredAt: 'Ajankohta',
    reference: 'Kohde',
    types: {
      'companySettings.updated': 'Oman yrityksen tietoja päivitetty',
      'customer.activated': 'Asiakas aktivoitu',
      'customer.created': 'Asiakas luotu',
      'customer.deactivated': 'Asiakas passivoitu',
      'customer.updated': 'Asiakasta päivitetty',
      'invoice.approved': 'Lasku hyväksytty',
      'invoice.cancelled': 'Lasku peruttu',
      'invoice.creditApproved': 'Hyvityslasku hyväksytty',
      'invoice.creditDraftCreated': 'Hyvitysluonnos luotu',
      'invoice.creditReapproved': 'Hyvityslasku hyväksytty uudelleen',
      'invoice.delivered': 'Lasku toimitettu',
      'invoice.reapproved': 'Lasku hyväksytty uudelleen',
      'invoice.reopenedForEdit': 'Lasku palautettu muokattavaksi',
    },
  },
  diagnostics: {
    component: 'Osa',
    components: {
      backend: 'Paikallinen palvelu',
      desktop: 'Työpöytäsovellus',
    },
    description:
      'Tekninen näkymä näyttää vain rajatut ja turvalliset tapahtumatiedot.',
    createSupportBundle: 'Luo tukipaketti',
    createSupportBundleError:
      'Tukipakettia ei voitu luoda turvallisesti.',
    creatingSupportBundle: 'Luodaan tukipakettia...',
    empty: 'Diagnostiikkatapahtumia ei ole vielä.',
    errorCode: 'Virhekoodi',
    event: 'Tapahtuma',
    heading: 'Diagnostiikka',
    kicker: 'Tekninen tila',
    loadError:
      'Diagnostiikkaa ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    loading: 'Ladataan diagnostiikkaa...',
    noErrorCode: 'Ei virhekoodia',
    occurredAt: 'Ajankohta',
    openLogFolder: 'Avaa lokikansio',
    openLogFolderError: 'Lokikansiota ei voitu avata turvallisesti.',
    outcomes: {
      blocked: 'Estetty',
      failure: 'Epäonnistui',
      success: 'Onnistui',
      unknown: 'Epäselvä',
    },
    status: 'Tila',
    supportBundleCreated: 'Tukipaketti luotiin onnistuneesti.',
  },
  customers: {
    add: 'Lisää',
    addCustomer: 'Lisää asiakas',
    additionalInformation: 'Lisätiedot',
    address: 'Osoite',
    active: 'Aktiivinen',
    activeFirst: 'Aktiiviset ensin',
    activeFirstShort: 'A ensin',
    actions: 'Toiminnot',
    allCustomers: 'Kaikki',
    automaticCustomerNumber: 'Luo automaattisesti',
    basicInformation: 'Perustiedot',
    businessId: 'Y-tunnus',
    cancel: 'Peruuta',
    created: 'Luotu',
    city: 'Kaupunki',
    close: 'Sulje',
    comment: 'Kommentti',
    contact: 'Yhteystieto',
    contactInformation: 'Yhteystiedot',
    collapseManagedHousingCompanies: 'Sulje taloyhtiöt',
    customer: 'Asiakas',
    customerCard: 'Asiakaskortti',
    customerList: 'Asiakaslista',
    customerModule: 'Asiakasmoduuli',
    customerNumber: 'Asiakasnumero',
    customerNumberHelp:
      'Automaattinen numero muodostetaan backendissä. Voit myös syöttää oman numeron, jos se on vapaa.',
    customerRegister: 'Asiakaskortisto',
    customers: 'Asiakkaat',
    customerType: 'Asiakastyyppi',
    customerTypeFilter: 'Asiakastyypin valinta',
    customerWorkspace: 'Asiakastyötila',
    description:
      'Täällä ylläpidetään asiakkaiden perustietoja ja asiakasryhmiä. Voit tarkastella yrityksiä, taloyhtiöitä, isännöitsijätoimistoja ja yksityisasiakkaita omissa näkymissään.',
    email: 'Sähköposti',
    editCustomer: 'Muokkaa asiakasta',
    empty: 'Asiakkaita ei ole vielä.',
    emptyForSearch: 'Haulla ei löytynyt asiakkaita.',
    emptyForSelectedType: 'Valitussa asiakastyypissä ei ole asiakkaita.',
    expandManagedHousingCompanies: 'Avaa taloyhtiöt',
    fallbackError: 'Jotain meni vikaan.',
    fillDummyCustomer: 'Täytä testiasiakas',
    fillDummyCustomerHelp: 'Täyttää lomakkeen satunnaisella dummy-datalla. Asiakasta ei tallenneta ennen kuin painat Lisää.',
    formDescription:
      'Täytä ensin perustiedot. Yhteystiedot, osoite ja kommentti täydentävät asiakaskorttia myöhempää käyttöä varten.',
    housingCompany: 'Taloyhtiö',
    hourlyRateOverride: 'Asiakaskohtainen tuntihinta €/h',
    hourlyRateOverrideHelp:
      'Jos kenttä jätetään tyhjäksi, käytetään oman yrityksen oletustuntihintaa.',
    inactive: 'Passivoitu',
    inactiveFirst: 'Passivoidut ensin',
    inactiveFirstShort: 'P ensin',
    invalidHourlyRate: 'Tuntihinnan pitää olla euroina, esimerkiksi 65 tai 65,50.',
    loading: 'Ladataan asiakkaita...',
    manualCustomerNumber: 'Syötä itse',
    managedByPropertyManager: 'Isännöitsijätoimisto',
    managedHousingCompanies: 'taloyhtiötä',
    name: 'Nimi',
    newCustomer: 'Uusi asiakas',
    newCustomerAction: 'Uusi asiakas',
    noPropertyManager: 'Ei valittu',
    noManagedHousingCompanies: 'Ei taloyhtiöitä',
    oneManagedHousingCompany: '1 taloyhtiö',
    organization: 'Yritys',
    other: 'Muu',
    phone: 'Puhelin',
    placeholderBusinessId: '1234567-8',
    placeholderCity: 'Kaupunki',
    placeholderComment: 'Sisäinen kommentti',
    placeholderCustomerNumber: '1001',
    placeholderEmail: 'asiakas@example.fi',
    placeholderHourlyRateOverride: '65,00',
    placeholderName: 'Esimerkki Asiakas Oy',
    placeholderPhone: '040 123 4567',
    placeholderPostalCode: '00100',
    placeholderStreetAddress: 'Katuosoite 1',
    postalCode: 'Postinumero',
    pricing: 'Hinnoittelu',
    privatePerson: 'Yksityishenkilö',
    propertyManager: 'Isännöitsijätoimisto',
    propertyManagerHelp:
      'Valitse isännöitsijätoimisto, jonka alle taloyhtiö kuuluu.',
    searchCustomer: 'Hae asiakasta',
    searchCustomerPlaceholder: 'Hae asiakasta...',
    saveChanges: 'Tallenna muutokset',
    saving: 'Tallennetaan',
    sortAscending: 'A-Ö',
    sortByCity: 'Paikkakunta',
    sortByColumn: 'Lajittele sarake',
    sortByCustomerNumber: 'Asiakasnumero',
    sortByCustomerType: 'Asiakastyyppi',
    sortByName: 'Nimi',
    sortByStatus: 'Tila',
    sortCustomers: 'Lajittelu',
    sortDescending: 'Ö-A',
    status: 'Tila',
    streetAddress: 'Katuosoite',
  },
  companySettings: {
    address: 'Osoite',
    bankDetails: 'Pankkitiedot',
    bankDetailsHelp:
      'Näitä tietoja käytetään myöhemmin laskun maksutiedoissa, PDF:ssä ja sähköpostilähetyksessä.',
    bankName: 'Pankin nimi',
    basicInformation: 'Perustiedot',
    bic: 'BIC',
    businessId: 'Y-tunnus',
    city: 'Kaupunki',
    companyName: 'Yrityksen nimi',
    companyAndContactInformation: 'Perustiedot ja yhteystiedot',
    contactInformation: 'Yhteystiedot',
    billingPrices: 'Laskutushinnat',
    defaultHourlyRate: 'Oletustuntihinta €/h',
    defaultHourlyRateHelp:
      'Jos asiakkaalle ei ole asetettu omaa tuntihintaa, laskutuksen pikavalinta käyttää tätä hintaa.',
    description:
      'Täällä ylläpidetään ohjelmaa käyttävän yrityksen perustietoja, oletustuntihintaa ja laskutuksen tuntityön pikavalintaa.',
    email: 'Sähköposti',
    emailDeliveryProvider: 'Sähköpostin lähetystapa',
    emailDeliverySettings: 'Sähköpostiasetukset',
    emailDeliverySettingsHelp:
      'Näillä asetuksilla valmistellaan laskun sähköpostilähetystä. SMTP-salasana hallitaan erikseen turvallisessa työpöytäsovelluksessa.',
    emailProviderDryRun: 'Kuivaharjoittelu',
    emailProviderDnaSmtp: 'DNA SMTP',
    emailDnaSmtpProfileHelp:
      'DNA SMTP käyttää aina suojattua yhteyttä: smtp.dnamail.fi, portti 465 ja implicit TLS (vähintään TLS 1.2). Näitä yhteysasetuksia ei voi muuttaa.',
    emailSenderAddress: 'Lähettäjän sähköpostiosoite',
    emailSenderName: 'Lähettäjän nimi',
    emailSecretChange: 'Vaihda salasana',
    emailSecretConfigured: 'Salasana asetettu',
    emailSecretDescription:
      'Salasana suojataan käyttöjärjestelmän salauksella. Sitä ei tallenneta yritystietoihin eikä näytetä tallennuksen jälkeen.',
    emailSecretDesktopOnly:
      'Salasanan hallinta on käytettävissä vain turvallisessa Eky-työpöytäsovelluksessa.',
    emailSecretHeading: 'SMTP-salasana',
    emailSecretHelp:
      'Anna postilaatikon salasana. Salasanaa ei esitäytetä, palauteta selaimelle eikä tallenneta lomakkeeseen.',
    emailSecretKicker: 'Sähköpostin suojaus',
    emailSecretLoadError:
      'SMTP-salasanan tilaa ei voitu tarkistaa. Yritä hetken kuluttua uudelleen.',
    emailSecretLoading: 'Tarkistetaan SMTP-salasanan tilaa...',
    emailSecretNewPassword: 'Uusi SMTP-salasana',
    emailSecretNotConfigured: 'Salasanaa ei ole asetettu',
    emailSecretPassword: 'SMTP-salasana',
    emailSecretRemove: 'Poista salasana',
    emailSecretRemoveConfirm:
      'Haluatko varmasti poistaa tallennetun SMTP-salasanan?',
    emailSecretRemoveError:
      'SMTP-salasanaa ei voitu poistaa turvallisesti. Yritä hetken kuluttua uudelleen.',
    emailSecretRemoveSuccess: 'SMTP-salasana poistettu.',
    emailSecretSaveError:
      'SMTP-salasanaa ei voitu tallentaa turvallisesti. Tarkista tieto ja yritä uudelleen.',
    emailSecretSaveSuccess: 'SMTP-salasana tallennettu turvallisesti.',
    emailSecretSaving: 'Tallennetaan...',
    emailSecretSet: 'Aseta salasana',
    emailSecretStatus: 'Salasanan tila',
    emailSmtpHost: 'SMTP-palvelin',
    emailSmtpPort: 'SMTP-portti',
    emailSmtpSecurity: 'Yhteyden suojaus',
    emailSmtpStartTls: 'STARTTLS',
    emailSmtpTls: 'TLS',
    emailTestRecipientOverride: 'SMTP-testin vastaanottaja',
    emailTestRecipientOverrideHelp:
      'Käytetään vain Testitoiminnot-osion hallituissa SMTP-testiviesteissä. Oikea lasku lähetetään laskulla vahvistettuun osoitteeseen.',
    emailUsername: 'SMTP-käyttäjätunnus',
    fallbackError: 'Jotain meni vikaan.',
    formDescription:
      'Täytä oman yrityksen tiedot ja tuntityön oletukset. Pankki- ja verkkolaskuasetukset lisätään myöhemmin erillisinä vaiheina.',
    formHeading: 'Oman yrityksen tiedot',
    formKicker: 'Asetukset',
    hourlyRateShortcut: 'Tuntityön pikavalinta',
    hourlyRateShortcutHelp:
      'Kun kirjoitat tämän sanan laskurivin nimikkeeksi, tuntihinta ehdotetaan kerran automaattisesti. Tyhjä kenttä poistaa pikavalinnan käytöstä.',
    invoiceNumberingDefaultInfo:
      'Näytetään oletusasetukset. Tallenna asetukset, jos haluat ottaa ne käyttöön ennen ensimmäisen laskun hyväksyntää.',
    invoiceNumberingDescription:
      'Määritä, miten viralliset laskunumerot muodostetaan hyväksynnässä. Varsinainen laskunumero annetaan vasta, kun lasku hyväksytään.',
    invoiceNumberingFirstSequenceNumber: 'Ensimmäinen numero',
    invoiceNumberingFiscalYearStartMonth: 'Tilikauden aloituskuukausi',
    invoiceNumberingHasUsedNumbering: 'Numerointia käytetty',
    invoiceNumberingHeading: 'Laskunumerointi',
    invoiceNumberingIsPersisted: 'Asetukset tallennettu',
    invoiceNumberingKicker: 'Laskutusasetukset',
    invoiceNumberingLoading: 'Ladataan laskunumeroinnin asetuksia...',
    invoiceNumberingLoadError:
      'Laskunumeroinnin asetuksia ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    invoiceNumberingLocked: 'Tallennus lukittu',
    invoiceNumberingMode: 'Numerointitapa',
    invoiceNumberingModes: {
      calendarYearSequence: 'Kalenterivuosittainen numerointi',
      fiscalYearSequence: 'Tilikausittainen numerointi',
      plainSequence: 'Jatkuva numerointi',
    },
    invoiceNumberingMonths: {
      april: 'Huhtikuu',
      august: 'Elokuu',
      december: 'Joulukuu',
      february: 'Helmikuu',
      january: 'Tammikuu',
      july: 'Heinäkuu',
      june: 'Kesäkuu',
      march: 'Maaliskuu',
      may: 'Toukokuu',
      november: 'Marraskuu',
      october: 'Lokakuu',
      september: 'Syyskuu',
    },
    invoiceNumberingSave: 'Tallenna numerointiasetukset',
    invoiceNumberingSaveError:
      'Laskunumeroinnin asetuksia ei voitu tallentaa. Tarkista tiedot ja yritä uudelleen.',
    invoiceNumberingSaveSuccess: 'Laskunumeroinnin asetukset tallennettu.',
    invoiceNumberingSequencePadding: 'Numeron vähimmäispituus',
    invoiceNumberingSequencePaddingHelp:
      'Esimerkiksi arvo 3 muodostaa sarjan numerot muodossa 001, 002 ja 003.',
    invoiceNumberingSeriesKey: 'Sarja',
    invoiceNumberingSettings: 'Numerointiasetukset',
    invoiceNumberingUsedWarning:
      'Numerointia on jo käytetty. Asetuksia ei voi muuttaa normaalisti, jotta laskunumerohistoria ei rikkoudu.',
    invoiceNumberingValidation: {
      firstSequenceNumberInvalid: 'Ensimmäisen numeron pitää olla vähintään 1.',
      fiscalYearStartMonthInvalid:
        'Tilikauden aloituskuukauden pitää olla välillä 1-12.',
      modeInvalid: 'Valitse kelvollinen numerointitapa.',
      sequencePaddingInvalid:
        'Numeron vähimmäispituuden pitää olla välillä 0-12.',
    },
    invoicePaymentDefaultInfo:
      'Näytetään oletusasetukset. Tallenna asetukset, jos haluat käyttää niitä uusien laskujen pohjana.',
    invoicePaymentDescription:
      'Määritä laskutuksen maksamiseen liittyvät oletukset. Uusi laskuluonnos voi myöhemmin ehdottaa näitä arvoja, mutta laskulle tallennetaan lopulta käyttäjän hyväksymä arvo.',
    invoicePaymentHeading: 'Maksuehdot ja viivästyskorko',
    invoicePaymentKicker: 'Laskutusasetukset',
    invoicePaymentLateInterest: 'Oletusviivästyskorko %',
    invoicePaymentLateInterestHelp:
      'Anna prosentti esimerkiksi muodossa 9,50. Arvoa voidaan myöhemmin ehdottaa laskulle, mutta sitä voi muuttaa laskukohtaisesti.',
    invoicePaymentLoading: 'Ladataan maksuehtoasetuksia...',
    invoicePaymentLoadError:
      'Maksuehtoasetuksia ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    invoicePaymentReminderPeriodDays: 'Huomautusaika päivinä',
    invoicePaymentReminderPeriodDaysHelp:
      'Esimerkiksi 8 tarkoittaa, että huomautusaika näkyy laskulla kahdeksana päivänä.',
    invoicePaymentSave: 'Tallenna maksuehtoasetukset',
    invoicePaymentSaveError:
      'Maksuehtoasetuksia ei voitu tallentaa. Tarkista tiedot ja yritä uudelleen.',
    invoicePaymentSaveSuccess: 'Maksuehtoasetukset tallennettu.',
    invoicePaymentSettings: 'Maksuehtoasetukset',
    invoicePaymentValidation: {
      latePaymentInterestInvalid:
        'Viivästyskoron pitää olla prosenttina, esimerkiksi 9,50.',
      reminderPeriodDaysInvalid:
        'Huomautusajan pitää olla kokonaisluku välillä 0-365.',
    },
    invoiceVatRatesKicker: 'Laskutusasetukset',
    invoiceVatRatesHeading: 'ALV-kannat',
    invoiceVatRatesDescription:
      'Ylläpidä uusilla laskuriveillä valittavia ALV-kantoja. Muutokset eivät muuta jo tallennettuja tai hyväksyttyjä laskuja.',
    invoiceVatRatesDefaultInfo:
      'Näytetään nykyinen oletuslista. Tallenna, jos haluat ottaa oman listan käyttöön.',
    invoiceVatRatesSettings: 'Valittavat ALV-kannat',
    invoiceVatRatesLoading: 'Ladataan ALV-kantoja...',
    invoiceVatRatesLoadError:
      'ALV-kantoja ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    invoiceVatRatesSaveError:
      'ALV-kantoja ei voitu tallentaa. Tarkista tiedot ja yritä uudelleen.',
    invoiceVatRatesSaveSuccess: 'ALV-kannat tallennettu.',
    invoiceVatRatesAdd: 'Lisää ALV-kanta',
    invoiceVatRatesRemove: 'Poista',
    invoiceVatRatesSave: 'Tallenna ALV-kannat',
    invoiceVatRatePercent: 'ALV %',
    invoiceVatRateLabel: 'Nimi',
    invoiceVatRateActive: 'Aktiivinen',
    invoiceVatRateDefault: 'Oletus',
    invoiceVatRateActions: 'Toiminnot',
    invoiceVatRatesValidation: {
      collectionInvalid: 'ALV-kantoja pitää olla 1–20.',
      defaultInvalid: 'Valitse yksi aktiivinen oletuskanta.',
      duplicateRate: 'Sama ALV-kanta on jo listalla.',
      labelInvalid: 'Anna nimelle 1–50 merkkiä yhdelle riville.',
      rateInvalid: 'Anna ALV-kanta väliltä 0–100 kahden desimaalin tarkkuudella.',
    },
    invalidHourlyRate: 'Tuntihinnan pitää olla euroina, esimerkiksi 65 tai 65,50.',
    invalidIban: 'IBAN-tilinumero ei ole kelvollinen.',
    invalidBic: 'BIC-koodi ei ole kelvollinen.',
    invalidBankName: 'Pankin nimi saa olla enintään 200 merkkiä.',
    invalidVatNumber: 'ALV-tunnuksen pitää olla muodossa FI ja 8 numeroa, esimerkiksi FI12345678.',
    invalidEmailSenderAddress: 'Lähettäjän sähköpostiosoite ei ole kelvollinen.',
    invalidEmailSmtpHost: 'SMTP-palvelimen osoite ei ole kelvollinen.',
    invalidEmailSmtpPort: 'SMTP-portin pitää olla kokonaisluku välillä 1-65535.',
    invalidEmailTestRecipient: 'Testivastaanottajan sähköpostiosoite ei ole kelvollinen.',
    iban: 'IBAN',
    loading: 'Ladataan oman yrityksen tietoja...',
    no: 'Ei',
    phone: 'Puhelin',
    website: 'Kotisivut',
    placeholderBusinessId: '1234567-8',
    placeholderBankName: 'Pankin nimi',
    placeholderBic: 'NDEAFIHH',
    placeholderCity: 'Kaupunki',
    placeholderCompanyName: 'Esimerkki Rakennus Oy',
    placeholderDefaultHourlyRate: '65,00',
    placeholderHourlyRateShortcut: 'työ',
    placeholderEmail: 'info@example.fi',
    placeholderEmailSenderAddress: 'laskutus@example.fi',
    placeholderEmailSenderName: 'Esimerkki Rakennus Oy',
    placeholderEmailSmtpHost: 'smtp.dnamail.fi',
    placeholderEmailSmtpPort: '587',
    placeholderEmailTestRecipientOverride: 'testi@example.fi',
    placeholderEmailUsername: 'laskutus@example.fi',
    placeholderIban: 'FI12 3456 7890 1234 56',
    placeholderPhone: '040 123 4567',
    placeholderWebsite: 'www.example.fi',
    placeholderPostalCode: '00100',
    placeholderStreetAddress: 'Katuosoite 1',
    placeholderVatNumber: 'FI12345678',
    postalCode: 'Postinumero',
    save: 'Tallenna',
    saveSuccess: 'Oman yrityksen tiedot tallennettu.',
    saving: 'Tallennetaan',
    streetAddress: 'Katuosoite',
    title: 'Oma yritys',
    vatNumber: 'ALV-tunnus',
    vatNumberHelp:
      'Valinnainen. Tämä tallennetaan myöhemmin hyväksytylle laskulle myyjän ALV-tunnukseksi.',
    workspace: 'Yritysasetukset',
    yes: 'Kyllä',
  },
  invoicing: {
    addRow: 'Lisää rivi',
    advancedInvoiceSettings: 'Laskun lisäasetukset',
    approveDraft: 'Hyväksy laskuksi',
    approveDraftConfirmAction: 'Hyväksy laskuksi',
    approveDraftConfirmationIntro:
      'Olet hyväksymässä laskuluonnoksen viralliseksi laskuksi.',
    approveDraftConfirmationLock:
      'Hyväksynnässä laskulle annetaan virallinen laskunumero ja viitenumero. Laskun tiedot snapshotataan ja luonnos lukitaan. Tämän jälkeen laskua ei voi enää muokata luonnoksena.',
    approveDraftConfirmationTitle: 'Hyväksynnän vahvistus',
    approveDraftError:
      'Laskua ei voitu hyväksyä. Tarkista laskun tiedot ja yritä uudelleen.',
    approveDraftNotFound:
      'Laskuluonnosta ei löytynyt tai se on jo hyväksytty.',
    approveDraftSuccess: 'Lasku hyväksyttiin.',
    approveDraftSuccessHelp:
      'Voit avata hyväksytyn laskun tarkistettavaksi ennen tulostus- ja PDF-vaihetta.',
    approveDraftUnsavedChanges: 'Tallenna muutokset ennen hyväksyntää.',
    approvedInvoiceKicker: 'Hyväksytty lasku',
    approvedInvoiceCount: 'Hyväksyttyjen laskujen määrä',
    approvedInvoiceList: 'Hyväksytyt laskut',
    approvedInvoiceListLoadError:
      'Hyväksyttyjä laskuja ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    approvedInvoiceLoadError:
      'Hyväksyttyä laskua ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    approvedInvoiceLoading: 'Ladataan hyväksyttyä laskua...',
    approvedInvoiceNotFound:
      'Hyväksyttyä laskua ei löytynyt.',
    approvedInvoiceOpenPrompt: 'Avaa hyväksytty lasku hyväksynnän jälkeen.',
    approvedInvoiceOpenPdf: 'Avaa PDF',
    approvedInvoicePdfCreate: 'Luo PDF',
    approvedInvoicePdfCreating: 'Luodaan PDF...',
    approvedInvoicePdfError:
      'PDF-tiedostoa ei voitu luoda tai avata. Yritä hetken kuluttua uudelleen.',
    approvedInvoicePreviewHelp:
      'Tämä on hyväksytyn laskun tarkistusnäkymä snapshot-tiedoista. Varsinainen tulostus- ja PDF-pohja tehdään seuraavassa vaiheessa.',
    approvedInvoicePreviewTitle: 'Hyväksytyn laskun katselu',
    approvedInvoices: 'Hyväksytyt',
    approvedInvoicesEmpty: 'Hyväksyttyjä laskuja ei ole vielä.',
    approvedInvoicesLoading: 'Ladataan hyväksyttyjä laskuja...',
    approvedAt: 'Hyväksytty',
    approvingDraft: 'Hyväksytään...',
    autosaveError: 'Automaattitallennus epäonnistui.',
    autosaveSaved: 'Tallennettu',
    autosaveSaving: 'Tallennetaan...',
    autosaveWaitingForValidForm:
      'Automaattitallennus odottaa kelvollisia tietoja.',
    backToDrafts: 'Takaisin luonnoksiin',
    basicInformation: 'Laskun perustiedot',
    basicInformationHelp:
      'Valitse asiakas ja täytä laskun perustiedot.',
    billingRecipient: 'Laskun vastaanottaja',
    billingRecipientHelp:
      'Valinnainen. Jos jätät tyhjäksi, laskun vastaanottaja on sama kuin asiakas.',
    billingRecipientPlaceholder: 'Sama kuin asiakas',
    businessId: 'Y-tunnus',
    copiedApprovedInvoice: 'Kopioidaan...',
    copyApprovedInvoice: 'Kopioi luonnokseksi',
    copyApprovedInvoiceConfirm:
      'Kopioidaanko lasku uudeksi luonnokseksi? Uusi luonnos saa myöhemmin oman laskunumeron ja viitenumeron.',
    copyApprovedInvoiceError:
      'Laskua ei voitu kopioida luonnokseksi. Yritä hetken kuluttua uudelleen.',
    cancel: 'Peruuta',
    cancelApprovedInvoice: 'Peru lasku',
    cancelApprovedInvoiceConflictError:
      'Laskua ei voi perua, koska sen tila tai toimitustilanne on muuttunut.',
    cancelApprovedInvoiceError:
      'Laskua ei voitu perua. Yritä hetken kuluttua uudelleen.',
    cancelApprovedInvoiceNumberHelp:
      'Kirjoita yllä näkyvä laskunumero täsmälleen vahvistukseksi.',
    cancelApprovedInvoiceNumberLabel: 'Vahvista laskunumero',
    cancelApprovedInvoiceReasonLabel: 'Peruutuksen syy',
    cancelApprovedInvoiceTitle: 'Peru hyväksytty lasku',
    cancelApprovedInvoiceValidationError:
      'Tarkista laskunumero ja peruutuksen syy.',
    cancelApprovedInvoiceWarning:
      'Peruutus säilyttää laskunumeron ja laskun tiedot, mutta laskua ei voi enää muokata tai toimittaa.',
    cancellingApprovedInvoice: 'Peruutetaan...',
    cancelledInvoiceCount: 'Peruttujen laskujen määrä',
    cancelledInvoiceList: 'Perutut laskut',
    cancelledInvoiceListLoadError:
      'Peruttuja laskuja ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    cancelledInvoices: 'Perutut',
    cancelledInvoicesEmpty: 'Peruttuja laskuja ei ole.',
    cancelledInvoicesLoading: 'Ladataan peruttuja laskuja...',
    confirmApprovedInvoiceCancellation: 'Vahvista peruutus',
    createCreditDraft: 'Hyvitä lasku',
    createCreditDraftConfirm:
      'Luodaanko tästä lähetetystä laskusta hyvitysluonnos? Voit rajata hyvitettävät rivit ja määrät ennen hyväksyntää.',
    creatingCreditDraft: 'Luodaan hyvitysluonnosta...',
    creditDraftConflictError:
      'Hyvitysluonnosta ei voi luoda tai muuttaa, koska laskun tila tai jäljellä oleva hyvitysmäärä on muuttunut.',
    creditDraftApprovalConflict:
      'Hyvityslaskua ei voitu hyväksyä, koska alkuperäisen laskun tila tai jäljellä oleva hyvitysmäärä on muuttunut. Päivitä hyvitysluonnos ennen uutta yritystä.',
    creditDraftApprovalError:
      'Hyvityslaskua ei voitu hyväksyä. Yritä hetken kuluttua uudelleen.',
    creditDraftApprovalHelp:
      'Nykyiset muutokset tallennetaan ensin. Hyväksynnässä hyvityslasku saa oman laskunumeron, eikä toimintoa tehdä automaattisesti.',
    creditDraftApprovalTitle: 'Hyväksytäänkö hyvityslasku?',
    creditDraftApprovalConfirm: 'Hyväksy hyvityslasku',
    creditDraftApprove: 'Hyväksy hyvityslasku',
    creditDraftApproving: 'Hyväksytään hyvityslaskua...',
    creditDraftError:
      'Hyvitysluonnosta ei voitu käsitellä. Yritä hetken kuluttua uudelleen.',
    creditedInvoiceCount: 'Hyvitettyjen laskujen määrä',
    creditedInvoiceList: 'Hyvitetyt laskut',
    creditedInvoiceListLoadError:
      'Hyvitettyjä laskuja ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    creditedInvoices: 'Hyvitetyt',
    creditedInvoicesEmpty: 'Hyvitettyjä tai osittain hyvitettyjä laskuja ei ole.',
    creditedInvoicesLoading: 'Ladataan hyvitettyjä laskuja...',
    creditDraftFacts: 'Hyvitysluonnoksen perustiedot',
    creditDraftHelp: (invoiceNumber: string, invoiceDate: string) =>
      `Hyvitys kohdistuu laskuun ${invoiceNumber}, päiväys ${invoiceDate}. Backend laskee hyvityksen lopulliset summat alkuperäisen laskun snapshotista.`,
    creditDraftIncludeLine: 'Hyvitä rivi',
    creditDraftAddManualLine: 'Lisää vapaa hyvitysrivi',
    creditDraftManualLine: 'Vapaa hyvitysrivi',
    creditDraftRemoveManualLine: 'Poista rivi',
    creditDraftKicker: 'Hyvitysluonnos',
    creditDraftLines: 'Hyvitettävät laskurivit',
    creditDraftLinesHelp:
      'Valitse hyvitettävät rivit ja anna enintään jäljellä oleva määrä. Hinta, ALV, alennus ja yksikkö tulevat alkuperäiseltä laskulta.',
    creditDraftLoading: 'Avataan hyvitysluonnosta...',
    creditDraftMaximumQuantity: (quantity: string, unit: string) =>
      `Enintään ${quantity} ${unit}`,
    creditDraftNotFound:
      'Hyvitysluonnosta tai sen alkuperäistä laskua ei löytynyt.',
    creditDraftOpenPrompt: 'Valitse avattava hyvitysluonnos listasta.',
    creditDraftQuantity: 'Hyvitettävä määrä',
    creditDraftRefundIban: 'Palautustili (IBAN)',
    creditDraftRefundIbanHelp:
      'Valinnainen tili, jolle asiakkaalle palautettava maksu ohjataan. Tyhjä arvo ei näy hyvityslaskulla.',
    creditDraftRefundIbanPlaceholder: 'FI12 3456 7890 1234 56',
    creditDraftSave: 'Tallenna hyvitysluonnos',
    creditDraftSaveSuccess: 'Hyvitysluonnoksen muutokset tallennettu.',
    creditDraftSavedLineTotal: 'Tallennettu hyvitys',
    creditDraftSaving: 'Tallennetaan hyvitysluonnosta...',
    creditDraftSourceInvoice: 'Alkuperäinen lasku',
    creditDraftTitle: 'Muokkaa hyvitysluonnosta',
    creditDraftTotalsHelp:
      'Näytetyt summat ovat viimeksi backendissä tallennetut hyvityssummat. Muutokset lasketaan uudelleen tallennettaessa.',
    creditDraftValidationError:
      'Tarkista hyvitysrivit, määrät, hinnat, ALV-kannat ja mahdollinen palautustili.',
    creditedInvoiceDate: 'Alkuperäisen laskun päiväys',
    creditedInvoiceNumber: 'Alkuperäinen lasku',
    creditInvoice: 'Hyvityslasku',
    creditInvoiceKicker: 'Hyväksytty hyvityslasku',
    creditContextLoadError:
      'Laskun hyvitystilannetta ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    creditContextLoading: 'Ladataan hyvitystilannetta...',
    creditRelations: 'Laskun hyvitykset',
    noRelatedCreditInvoices: 'Laskuun ei liity hyväksyttyjä hyvityslaskuja.',
    openActiveCreditDraft: 'Avaa keskeneräinen hyvitysluonnos',
    openCreditedInvoice: (invoiceNumber: string) =>
      `Avaa alkuperäinen lasku ${invoiceNumber}`,
    creditStatus: 'Hyvitystilanne',
    creditStatusFull: 'Hyvitetty kokonaan',
    creditStatusNone: 'Ei hyvityksiä',
    creditStatusPartial: 'Osittain hyvitetty',
    remainingCreditableAmount: (amount: string) =>
      `Hyvitettävissä ${amount}`,
    remainingCreditableLabel: 'Hyvitettävissä jäljellä',
    customer: 'Asiakas',
    customerEmpty: 'Asiakkaita ei ole',
    customerEmptyHelp:
      'Luo ensin asiakas asiakaskortistossa ja palaa sitten laskulle.',
    customerDefaultHourlyRate: 'Käytetään oman yrityksen oletustuntihintaa',
    customerHourlyRate: 'Asiakaskohtainen tuntihinta',
    customerInactive: 'passivoitu',
    customerLoadError:
      'Asiakkaita ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    customerLoading: 'Ladataan asiakkaita...',
    customerNotFound: 'Asiakasta ei löytynyt',
    customerLoadingHelp: 'Asiakaslista haetaan paikalliselta backendiltä.',
    customerPickerHelp:
      'Valitse laskutettava asiakas asiakasnumeron ja nimen perusteella.',
    customerNoMatches: 'Haulla ei löytynyt asiakkaita',
    customerPlaceholder: 'Valitse asiakas',
    customerSearch: 'Hae asiakasta',
    customerSearchPlaceholder: 'Hae numerolla tai nimellä',
    customerUnavailable: 'Asiakaslista ei ole käytettävissä',
    companySettingsLoadError:
      'Tuntihinnan pikavalintaa ei voitu ladata. Voit syöttää hinnan käsin.',
    selectedCustomerKicker: 'Valittu asiakas',
    description:
      'Täällä käsitellään laskuluonnoksia. Ensimmäinen näkymä kokoaa tallennetut luonnokset selkeäksi työlistaksi.',
    draftCount: 'Laskuluonnosten määrä',
    draftList: 'Laskuluonnoslista',
    drafts: 'Luonnokset',
    deleteDraft: 'Poista laskuluonnos',
    deleteDraftCancel: 'Peruuta',
    deleteDraftConfirm: 'Haluatko varmasti poistaa laskuluonnoksen?',
    deleteDraftConfirmAction: 'Poista luonnos',
    deleteDraftError:
      'Laskuluonnosta ei voitu poistaa. Yritä hetken kuluttua uudelleen.',
    deletingDraft: 'Poistetaan...',
    deliveryAddressText: 'Toimitus / kohde',
    deliveryAddressTextHelp:
      'Näkyy myöhemmin laskulla työn kohteena tai toimitusosoitteena.',
    deliveryAddressTextPlaceholder: 'Työn kohde tai toimitusosoite',
    dueDate: 'Eräpäivä',
    editApprovedInvoice: 'Muokkaa laskua',
    editInvoice: 'Muokkaa laskuluonnosta',
    editInvoiceKicker: 'Tallennettu luonnos',
    empty: 'Laskuluonnoksia ei ole vielä.',
    invoice: 'Lasku',
    invoiceAdditionalDetailsPreview: 'Laskulla näkyvät työn lisätiedot',
    invoiceDate: 'Laskun päiväys',
    invoiceEmailAttachment: 'Liite',
    invoiceEmailBody: 'Viestin sisältö',
    invoiceEmailBodyRequired: 'Kirjoita viestin sisältö.',
    invoiceEmailBodyTooLong: 'Viestin sisältö on liian pitkä.',
    invoiceEmailCc: 'Kopio / Cc',
    invoiceEmailCcInvalid:
      'Anna kelvollinen kopion sähköpostiosoite tai jätä kenttä tyhjäksi.',
    invoiceEmailCcTooLong: 'Kopion sähköpostiosoite on liian pitkä.',
    invoiceEmailDryRunBadge: 'Valmis vahvistettavaksi',
    invoiceEmailEditHelp:
      'Voit muokata vastaanottajaa, kopiota, otsikkoa ja viestiä. Tarkista tiedot huolellisesti ennen lähettämistä.',
    invoiceEmailDryRunHelp:
      'Sähköposti lähetetään vasta, kun painat Lähetä lasku. Desktop-sovellus pyytää lisäksi vahvistuksen suojatussa ikkunassa.',
    invoiceEmailDryRunKicker: 'Laskun sähköposti',
    invoiceEmailDryRunSend: 'Kuivaharjoittele lähetys',
    invoiceEmailDryRunSending: 'Kirjataan kuivaharjoittelua...',
    invoiceEmailDryRunSendError:
      'Sähköpostin kuivaharjoittelua ei voitu kirjata. Yritä hetken kuluttua uudelleen.',
    invoiceEmailDryRunSendSuccess:
      'Kuivaharjoittelu kirjattiin. Sähköpostia ei lähetetty.',
    invoiceEmailDryRunValidationError:
      'Tarkista vastaanottaja, kopio, otsikko ja viestin sisältö.',
    invoiceEmailNoRecipient: 'Vastaanottajan sähköpostia ei ole asetettu',
    invoiceEmailPrepare: 'Valmistele sähköposti',
    invoiceEmailPrepareError:
      'Sähköpostiluonnosta ei voitu valmistella. Yritä hetken kuluttua uudelleen.',
    invoiceEmailPreparing: 'Valmistellaan...',
    invoiceEmailPreviewTitle: 'Sähköpostin esikatselu',
    invoiceEmailRecipientInvalid:
      'Anna kelvollinen vastaanottajan sähköpostiosoite.',
    invoiceEmailRecipientRequired: 'Anna vastaanottajan sähköpostiosoite.',
    invoiceEmailRecipientTooLong:
      'Vastaanottajan sähköpostiosoite on liian pitkä.',
    invoiceEmailSubject: 'Otsikko',
    invoiceEmailSubjectInvalid: 'Tarkista sähköpostin otsikko.',
    invoiceEmailSubjectInput: 'Sähköpostin otsikko',
    invoiceEmailSubjectRequired: 'Anna sähköpostin otsikko.',
    invoiceEmailSmtpTestActualRecipient: 'Todellinen testivastaanottaja',
    invoiceEmailSmtpTestConflict:
      'SMTP-testilähetys on jo käynnissä, valtuutus vanheni tai lyhyt varoaika on voimassa. Odota hetki ja valmistele lähetys uudelleen.',
    invoiceEmailSmtpTestError:
      'SMTP-testilähetystä ei voitu tehdä. Laskua ei merkitty lähetetyksi.',
    invoiceEmailSmtpTestHelp:
      'Testilähetys käyttää vain alla näkyvää testivastaanottajaa. Vastaanottaja- ja Cc-kenttiä ei käytetä SMTP-testin toimitusosoitteina, eikä laskua merkitä lähetetyksi.',
    invoiceEmailSmtpTestMissingRecipient:
      'Aseta ensin Oma yritys -näkymässä sähköpostin testivastaanottaja.',
    invoiceEmailSmtpTestProfileMissing:
      'Valitse ensin Oma yritys -näkymässä sähköpostin lähetystavaksi DNA SMTP.',
    invoiceEmailSmtpTestSecretMissing:
      'Aseta SMTP-salasana turvallisessa Eky-työpöytäsovelluksessa. Selainkehityksessä oikea DNA SMTP -testi ei ole käytettävissä.',
    invoiceEmailSmtpTestSettingsIncomplete:
      'Täydennä Oma yritys -näkymässä lähettäjän osoite, SMTP-käyttäjätunnus ja testivastaanottaja.',
    invoiceEmailSmtpTestSettingsLoading:
      'Tarkistetaan DNA SMTP -testin asetuksia...',
    invoiceEmailSmtpTestSettingsUnavailable:
      'DNA SMTP -testin asetuksia ei voitu tarkistaa turvallisesti.',
    invoiceEmailSmtpTestOutcomeUnknown:
      'SMTP-testin lopputulosta ei voitu varmistaa. Älä yritä heti uudelleen, vaan tarkista testipostilaatikko ja toimitustapahtuma.',
    invoiceEmailSmtpTestSend: 'Lähetä hallittu SMTP-testi',
    invoiceEmailSmtpTestSending: 'Lähetetään testivastaanottajalle...',
    invoiceEmailSmtpTestSuccess: 'SMTP-testi lähetettiin osoitteeseen',
    invoiceEmailSmtpCancelled: 'Sähköpostilähetys peruutettiin.',
    invoiceEmailSmtpConflict:
      'Lähetys on jo käynnissä, vahvistus vanheni tai lyhyt varoaika on voimassa. Odota hetki ja valmistele lähetys uudelleen.',
    invoiceEmailSmtpPersistentConflict:
      'Laskulla on toimitusyritys, jonka lopputulosta ei ole varmistettu. Tarkista toimitushistoria ennen uutta lähetystä.',
    invoiceEmailSmtpError:
      'Laskun sähköpostia ei voitu lähettää. Laskua ei merkitty lähetetyksi.',
    invoiceEmailSmtpOutcomeUnknown:
      'Lähetyksen lopputulosta ei voitu varmistaa. Älä lähetä heti uudelleen. Tarkista toimitushistoria ja varmista vastaanottajalta toimituksen tila.',
    invoiceEmailSmtpProfileMissing:
      'Valitse ensin Oma yritys -näkymässä sähköpostin lähetystavaksi DNA SMTP.',
    invoiceEmailSmtpSecretMissing:
      'Aseta SMTP-salasana turvallisessa Eky-työpöytäsovelluksessa.',
    invoiceEmailSmtpSettingsIncomplete:
      'Täydennä Oma yritys -näkymässä lähettäjän osoite ja SMTP-käyttäjätunnus.',
    invoiceEmailSmtpSettingsLoading:
      'Tarkistetaan sähköpostilähetyksen asetuksia...',
    invoiceEmailSmtpSettingsUnavailable:
      'Sähköpostilähetyksen asetuksia ei voitu tarkistaa turvallisesti.',
    invoiceEmailSmtpSend: 'Lähetä lasku',
    invoiceEmailSmtpResend: 'Lähetä uudelleen',
    invoiceEmailSmtpSending: 'Lähetetään...',
    invoiceEmailSmtpSendSuccess: 'Lasku lähetettiin ja merkittiin lähetetyksi.',
    invoiceEmailSmtpResendSuccess: 'Lasku lähetettiin uudelleen.',
    invoiceEmailTestTools: 'Testitoiminnot',
    invoiceEmailTo: 'Vastaanottaja',
    invoiceEmailToInput: 'Vastaanottajan sähköposti',
    invoiceEmailCcSameAsRecipient:
      'Vastaanottaja ja kopion saaja eivät voi olla sama osoite.',
    invoiceDeliveryHistory: 'Toimitushistoria',
    invoiceDeliveryHistoryEmpty: 'Laskulle ei ole vielä toimitustapahtumia.',
    invoiceDeliveryHistoryError:
      'Laskun toimitushistoriaa ei voitu ladata turvallisesti.',
    invoiceDeliveryHistoryFailure: 'Toimitus epäonnistui.',
    invoiceDeliveryHistoryLoading: 'Ladataan toimitushistoriaa...',
    invoiceDeliveryHistoryOutcomeUnknown:
      'Toimituksen lopputulosta ei voitu varmistaa.',
    invoiceDeliveryMethod: 'Toimitustapa',
    invoiceDeliveryMethods: {
      email: 'Sähköposti',
      manual: 'Muu käsin toimitettu',
      other: 'Muu',
      print: 'Tulostettu',
    },
    invoiceDeliveryProvider: 'Palvelu',
    invoiceDeliveryProviders: {
      dryRun: 'Kuivaharjoittelu',
      gmail: 'Gmail',
      manual: 'Käsin',
      microsoft: 'Microsoft',
      other: 'Muu',
      smtp: 'SMTP',
    },
    invoiceDeliveryStatuses: {
      attempted: 'Käynnissä',
      failed: 'Epäonnistui',
      outcomeUnknown: 'Lopputulos epäselvä',
      prepared: 'Valmisteltu',
      succeeded: 'Onnistui',
    },
    listFilters: 'Laskulistan suodattimet',
    listFiscalYearStart: 'Tilikauden alkamisvuosi',
    listMonth: 'Kuukausi',
    listNextPage: 'Seuraava',
    listPageLabel: (page: number, totalPages: number) =>
      `Sivu ${page} / ${totalPages}`,
    listPages: 'Laskulistan sivut',
    listPageSize: 'Rivejä sivulla',
    listPeriod: 'Ajanjakso',
    listPeriodAll: 'Kaikki',
    listPeriodFiscalYear: 'Tilikausi',
    listPeriodMonth: 'Kuukausi',
    listPreviousPage: 'Edellinen',
    listSort: 'Järjestys',
    listSortCustomer: 'Asiakas A–Ö',
    listSortDueDate: 'Eräpäivä ensin',
    listSortNewest: 'Uusimmat ensin',
    listSortOldest: 'Vanhimmat ensin',
    invoiceDeliveryTime: 'Aika',
    notApplicable: 'Ei käytössä',
    invoiceNumber: 'Laskunumero',
    invoiceRecipient: 'Laskun vastaanottaja',
    invoicePreviewOpen: 'Avaa hyväksytty lasku',
    invoiceRows: 'Laskurivit',
    invoiceRowsHelp:
      'Lisää laskutettavat työt ja tuotteet riveittäin. Summat tarkistetaan backendissä tallennettaessa.',
    markApprovedInvoiceSent: 'Merkitse käsin toimitetuksi',
    markingApprovedInvoiceSent: 'Merkitään toimitetuksi...',
    markApprovedInvoiceSentConfirm:
      'Merkitäänkö lasku käsin toimitetuksi? Lähetettyä laskua ei voi enää palauttaa muokattavaksi.',
    markApprovedInvoiceSentError:
      'Laskua ei voitu merkitä lähetetyksi. Yritä hetken kuluttua uudelleen.',
    fillDummyInvoice: 'Täytä testilasku',
    invoicePaymentSettingsLoadError:
      'Laskutuksen oletusarvoja ei voitu ladata. Voit syöttää arvot käsin.',
    invoiceVatRatesLoadError:
      'ALV-kantoja ei voitu ladata. Nykyiset oletuskannat ovat käytettävissä.',
    hourlyRateShortcutHelpPrefix: 'Pikavalinta',
    hourlyRateShortcutHelpSuffix:
      'täyttää valitun asiakkaan tuntihinnan kerran automaattisesti.',
    latePaymentInterest: 'Viivästyskorko %',
    latePaymentInterestHelp:
      'Tyhjä kenttä käyttää oman yrityksen laskutusasetusten oletusta.',
    latePaymentInterestPlaceholder: 'esim. 9,50',
    invoiceTotals: 'Laskun summat',
    invoiceTotalsLater:
      'Summat lasketaan backendin sääntöjen mukaan tallennusvaiheessa.',
    invoiceTotalsPreviewHelp:
      'Esikatselu auttaa tarkistamaan rivit. Backend laskee lopulliset summat tallennuksessa.',
    invoiceTotalsUnavailable:
      'Summia ei voida näyttää ennen kuin rivit ovat kelvollisia.',
    grossTotal: 'Brutto',
    loadError: 'Laskuluonnoksia ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    loading: 'Ladataan laskuluonnoksia...',
    newInvoice: 'Uusi lasku',
    newInvoiceKicker: 'Laskuluonnos',
    netAmount: 'Netto',
    netTotal: 'Veroton',
    notSet: 'Ei asetettu',
    note: 'Lisätieto',
    notePlaceholder: 'Laskulla näkyvä saate tai lisätieto',
    orderNumber: 'Tilausnumero',
    orderNumberPlaceholder: 'Asiakkaan tilausnumero',
    paymentTermDays: 'Maksuehto päivinä',
    paymentDetails: 'Maksutiedot',
    postalCodeAndCity: 'Postinumero ja kaupunki',
    priceInputGross: 'Verollinen hinta',
    priceInputMode: 'Hintojen syöttötapa',
    priceInputNet: 'Veroton hinta',
    performanceDate: 'Suorituspäivä',
    performancePeriod: 'Suoritusajankohta',
    performancePeriodDateRange: 'Laskutusjakso',
    performancePeriodEnd: 'Jakson loppupäivä',
    performancePeriodInvoiceDate: 'Sama kuin laskun päivä',
    performancePeriodSingleDate: 'Yksittäinen suorituspäivä',
    performancePeriodStart: 'Jakson alkupäivä',
    referenceNumber: 'Viitenumero',
    reverseChargeApprovalConfirmation: (
      customerName: string,
      businessId: string,
    ) =>
      `Vahvistan, että rakennusalan käännetty verovelvollisuus soveltuu juridiselle ostajalle ${customerName} (${businessId}).`,
    reverseChargeBusinessIdMissing: 'Y-tunnus puuttuu',
    reverseChargeCustomerEligibilityError:
      'Käännetty verovelvollisuus vaatii yritysasiakkaan ja tämän Y-tunnuksen.',
    reverseChargeCustomerMissing: 'Asiakasta ei ole valittu',
    reverseChargeLegalCustomer: 'Juridinen ostaja',
    reverseChargeNetOnlyError:
      'Käännetty verovelvollisuus sallii vain verottomien hintojen syöttämisen.',
    reverseChargeNetOnlyHelp:
      'Käännetyssä verovelvollisuudessa hinnat syötetään verottomina.',
    reverseChargeNoSellerVat:
      'Myyjän laskulle lisäämä arvonlisävero on 0,00 €. Ostaja vastaa veron käsittelystä.',
    reverseChargeWarning:
      'Valitse tämä vain, kun rakennusalan käännetyn verovelvollisuuden ehdot täyttyvät. Ohjelma ei päättele soveltuvuutta automaattisesti.',
    reverseChargeWarningTitle: 'Tarkista verokäsittely huolellisesti',
    reopenApprovedInvoiceConfirm:
      'Tämä lasku on jo hyväksytty ja sillä on laskunumero. Muokkaus kirjataan tapahtumahistoriaan ja lasku palautetaan luonnokseksi korjausta varten. Jatketaanko?',
    reopenApprovedInvoiceError:
      'Laskua ei voitu palauttaa muokattavaksi. Yritä hetken kuluttua uudelleen.',
    reopeningApprovedInvoice: 'Palautetaan...',
    reminderPeriodDays: 'Huomautusaika päivinä',
    reminderPeriodDaysHelp:
      'Tyhjä kenttä käyttää oman yrityksen laskutusasetusten oletusta.',
    reminderPeriodDaysPlaceholder: 'esim. 8',
    discountFixed: 'Euromäärä',
    discountNone: 'Ei alennusta',
    discountPercentage: 'Prosentti',
    keepOneRow: 'Laskulla pitää olla vähintään yksi rivi.',
    removeRow: 'Poista',
    row: 'Rivi',
    rowActions: 'Toiminnot',
    rowCode: 'Koodi',
    rowDescription: 'Nimike',
    rowDescriptionPlaceholder: 'Työn tai tuotteen kuvaus',
    rowCustomUnit: 'Oma yksikkö',
    rowCustomUnitPlaceholder: 'oma',
    rowDiscountType: 'Alennus',
    rowDiscountValue: 'Alennuksen arvo',
    rowDiscountValuePlaceholder: '0,00',
    toggleRowDiscount: 'Alennus',
    rowQuantity: 'Määrä',
    rowTotal: 'Rivin summa',
    rowUnit: 'Yksikkö',
    rowUnitPrice: 'Yksikköhinta',
    rowUnitPricePlaceholder: '0,00',
    rowVat: 'ALV %',
    seller: 'Myyjä',
    save: 'Tallenna',
    saveDraft: 'Tallenna luonnos',
    saveDraftChanges: 'Tallenna muutokset',
    saveDraftChangesSuccess: 'Laskuluonnoksen muutokset tallennettu.',
    saveDraftError:
      'Laskuluonnosta ei voitu tallentaa. Tarkista tiedot ja yritä uudelleen.',
    saveDraftLater: 'Tallennus otetaan käyttöön vaiheessa 5.',
    saveDraftSuccess: 'Laskuluonnos tallennettu.',
    savingDraftChanges: 'Tallennetaan muutoksia...',
    savingDraft: 'Tallennetaan luonnosta...',
    sentInvoiceCount: 'Lähetettyjen laskujen määrä',
    sentInvoiceList: 'Lähetetyt laskut',
    sentInvoices: 'Lähetetyt',
    sentInvoicesEmpty: 'Lähetettyjä laskuja ei ole vielä.',
    sentInvoicesLoading: 'Ladataan lähetettyjä laskuja...',
    sentInvoiceListLoadError:
      'Lähetettyjä laskuja ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    openDraftError:
      'Laskuluonnosta ei voitu avata. Yritä hetken kuluttua uudelleen.',
    openDraftPrompt: 'Valitse avattava laskuluonnos listasta.',
    openingDraft: 'Avataan laskuluonnosta...',
    open: 'Avaa',
    status: 'Tila',
    statusApproved: 'Hyväksytty',
    statusCancelled: 'Peruutettu',
    statusCredited: 'Hyvitetty',
    statusCreditDraft: 'Hyvitysluonnos',
    statusDraft: 'Luonnos',
    statusSent: 'Lähetetty',
    subject: 'Aihe',
    subjectFallback: 'Nimetön laskuluonnos',
    subjectPlaceholder: 'Laskutuksen aihe',
    title: 'Laskutus',
    total: 'Yhteensä',
    unitBatch: 'erä',
    unitDay: 'pv',
    unitHour: 'h',
    unitKilometre: 'km',
    unitPackage: 'pak',
    unitPiece: 'kpl',
    unitCustom: 'Oma yksikkö',
    vatAmount: 'Vero',
    vatTotal: 'ALV',
    vatBreakdown: 'ALV-erittely',
    taxTreatment: 'Verokäsittely',
    taxTreatmentNormalVat: 'Normaali arvonlisävero',
    taxTreatmentReverseChargeConstruction:
      'Rakennusalan käännetty verovelvollisuus',
    taxLegalBasis: 'Veroperuste',
    validationPerformanceDate: 'Anna kelvollinen suorituspäivä.',
    validationPerformancePeriodEnd:
      'Anna kelvollinen laskutusjakson päättymispäivä.',
    validationPerformancePeriodOrder:
      'Laskutusjakson päättymispäivä ei saa olla ennen alkamispäivää.',
    validationPerformancePeriodStart:
      'Anna kelvollinen laskutusjakson alkamispäivä.',
    vatRate: 'ALV',
    validateForm: 'Tarkista tiedot',
    validationCustomerRequired: 'Valitse laskutettava asiakas.',
    validationDateInvalid: 'Syötä päiväys muodossa vvvv-kk-pp.',
    validationDeliveryAddressText:
      'Toimitus- tai kohdetieto saa olla enintään 500 merkkiä.',
    validationDescriptionRequired: 'Kirjoita riville nimike.',
    validationDueDateBeforeInvoiceDate:
      'Eräpäivä ei voi olla ennen laskun päiväystä.',
    validationLatePaymentInterest:
      'Viivästyskorko pitää antaa prosenttina, esimerkiksi 9,50.',
    validationDueDateRequired: 'Syötä eräpäivä.',
    validationFixedDiscountInvalid:
      'Syötä euromääräinen alennus nollana tai positiivisena arvona.',
    validationInvoiceDateRequired: 'Syötä laskun päiväys.',
    validationPaymentTerm:
      'Syötä maksuehto kokonaisina päivinä, vähintään 0.',
    validationPercentageDiscountInvalid:
      'Syötä prosenttialennus väliltä 0–100.',
    validationQuantityInvalid:
      'Syötä määrä enintään kahdella desimaalilla.',
    validationQuantityPositive: 'Määrän pitää olla suurempi kuin 0.',
    validationReminderPeriod:
      'Syötä huomautusaika kokonaisina päivinä väliltä 0–365.',
    validationSummary: 'Tarkista lomakkeen merkityt kohdat.',
    validationSuccess:
      'Tiedot ovat valmiit luonnoksen tallennusta varten.',
    validationUnitInvalid:
      'Syötä yksikkö 1–8 merkillä. Sallitut merkit ovat kirjaimet, numerot, piste ja väliviiva.',
    validationUnitPriceInvalid:
      'Syötä yksikköhinta nollana tai positiivisena euromääränä.',
    workspace: 'Laskutustyötila',
  },
  apiErrors: {
    'API request failed.': 'API-pyyntö epäonnistui.',
    'Customer business id must be 200 characters or less.':
      'Y-tunnus saa olla enintään 200 merkkiä.',
    'Customer city must be 200 characters or less.':
      'Kaupunki saa olla enintään 200 merkkiä.',
    'Customer comment must be 1000 characters or less.':
      'Kommentti saa olla enintään 1000 merkkiä.',
    'Customer email must be 200 characters or less.':
      'Sähköposti saa olla enintään 200 merkkiä.',
    'Customer hourly rate cannot be negative.':
      'Asiakaskohtainen tuntihinta ei voi olla negatiivinen.',
    'Customer hourly rate must be whole cents.':
      'Asiakaskohtainen tuntihinta pitää antaa sentin tarkkuudella.',
    'Customer name is required.': 'Asiakkaan nimi on pakollinen.',
    'Customer name must be 200 characters or less.':
      'Asiakkaan nimi saa olla enintään 200 merkkiä.',
    'Customer number is required.': 'Asiakasnumero on pakollinen.',
    'Customer number already exists.': 'Asiakasnumero on jo käytössä.',
    'Customer number mode is invalid.': 'Asiakasnumeron valintatapa on virheellinen.',
    'Customer number must be 50 characters or less.':
      'Asiakasnumero saa olla enintään 50 merkkiä.',
    'Customer cannot manage itself.': 'Asiakas ei voi toimia omana isännöitsijänään.',
    'Customer not found.': 'Asiakasta ei löytynyt.',
    'Managed by customer id must be 200 characters or less.':
      'Isännöitsijätoimiston tunniste saa olla enintään 200 merkkiä.',
    'Managed by customer must be a property manager.':
      'Valitun asiakkaan pitää olla isännöitsijätoimisto.',
    'Customer phone must be 200 characters or less.':
      'Puhelinnumero saa olla enintään 200 merkkiä.',
    'Customer postal code must be 200 characters or less.':
      'Postinumero saa olla enintään 200 merkkiä.',
    'Customer status is invalid.': 'Asiakkaan tila on virheellinen.',
    'Customer street address must be 200 characters or less.':
      'Katuosoite saa olla enintään 200 merkkiä.',
    'Customer type is invalid.': 'Asiakastyyppi on virheellinen.',
    'Invalid customer response.': 'Asiakastietojen vastaus oli virheellinen.',
    'Invalid customers response.': 'Asiakaslistan vastaus oli virheellinen.',
    'Company business id must be 200 characters or less.':
      'Y-tunnus saa olla enintään 200 merkkiä.',
    'Company city must be 200 characters or less.':
      'Kaupunki saa olla enintään 200 merkkiä.',
    'Company email must be 200 characters or less.':
      'Sähköposti saa olla enintään 200 merkkiä.',
    'Company name must be 200 characters or less.':
      'Yrityksen nimi saa olla enintään 200 merkkiä.',
    'Company phone must be 200 characters or less.':
      'Puhelinnumero saa olla enintään 200 merkkiä.',
    'Company postal code must be 200 characters or less.':
      'Postinumero saa olla enintään 200 merkkiä.',
    'Company street address must be 200 characters or less.':
      'Katuosoite saa olla enintään 200 merkkiä.',
    'Default hourly rate cannot be negative.':
      'Oletustuntihinta ei voi olla negatiivinen.',
    'Default hourly rate must be whole cents.':
      'Oletustuntihinta pitää antaa sentin tarkkuudella.',
    'Hourly rate shortcut must be 50 characters or less.':
      'Tuntityön pikavalinta saa olla enintään 50 merkkiä.',
    'Hourly rate shortcut must be a single line.':
      'Tuntityön pikavalinnan pitää olla yhdellä rivillä.',
    'IBAN is invalid.': 'IBAN-tilinumero ei ole kelvollinen.',
    'BIC is invalid.': 'BIC-koodi ei ole kelvollinen.',
    'Bank name must be 200 characters or less.':
      'Pankin nimi saa olla enintään 200 merkkiä.',
    'Invalid company settings body.': 'Oman yrityksen pyyntö oli virheellinen.',
    'Invalid company settings response.':
      'Oman yrityksen tietojen vastaus oli virheellinen.',
    'Invalid company email secret body.':
      'SMTP-salasanan pyyntö oli virheellinen.',
    'Invalid company email secret response.':
      'SMTP-salasanan tilan vastaus oli virheellinen.',
    'Email secret is required.': 'Anna SMTP-salasana.',
    'Email secret must be text.': 'SMTP-salasanan pitää olla tekstiä.',
    'Email secret must be 1024 characters or less.':
      'SMTP-salasana saa olla enintään 1024 merkkiä.',
    'Email secret contains an unsupported null character.':
      'SMTP-salasana sisältää merkin, jota ei tueta.',
    'Email secret storage is unavailable.':
      'Turvallinen SMTP-salasanan säilytys ei ole käytettävissä.',
    'Invalid JSON body.': 'Pyyntö oli virheellinen.',
    'Invalid JSON response.': 'Palvelimen vastaus oli virheellinen.',
    'Invalid invoice draft response.':
      'Laskuluonnoksen vastaus oli virheellinen.',
    'Invalid approved invoice response.':
      'Hyväksytyn laskun vastaus oli virheellinen.',
    'Invalid invoice numbering settings response.':
      'Laskunumeroinnin asetusten vastaus oli virheellinen.',
    'Invalid invoice payment settings body.':
      'Maksuehtoasetusten pyyntö oli virheellinen.',
    'Invalid invoice payment settings response.':
      'Maksuehtoasetusten vastaus oli virheellinen.',
    'Invalid invoice VAT rates body.':
      'ALV-kantojen pyyntö oli virheellinen.',
    'Invalid invoice VAT rates response.':
      'ALV-kantojen vastaus oli virheellinen.',
    'Invoice VAT rates body is too large.':
      'ALV-kantojen pyyntö on liian suuri.',
    'Invoice VAT rates must contain between 1 and 20 items.':
      'ALV-kantoja pitää olla 1–20.',
    'Invoice VAT rates must be unique.':
      'Jokainen ALV-kanta saa esiintyä listalla vain kerran.',
    'Invoice VAT rates must have exactly one default.':
      'Valitse yksi ALV-oletuskanta.',
    'Default invoice VAT rate must be active.':
      'ALV-oletuskannan pitää olla aktiivinen.',
    'Invoice VAT rate label is invalid.':
      'ALV-kannan nimi on virheellinen.',
    'Invoice payment settings body is too large.':
      'Maksuehtoasetusten pyyntö on liian suuri.',
    'Invoice numbering settings were not found.':
      'Laskunumeroinnin asetuksia ei löytynyt.',
    'Default late payment interest must be between 0 and 100000.':
      'Viivästyskoron pitää olla välillä 0-1000 %.',
    'Default late payment interest must be a safe integer.':
      'Viivästyskorko oli virheellinen.',
    'Default reminder period days must be between 0 and 365.':
      'Huomautusajan pitää olla välillä 0-365 päivää.',
    'Default reminder period days must be a safe integer.':
      'Huomautusaika oli virheellinen.',
    'Invoice numbering settings cannot be changed after numbering has been used.':
      'Numerointia on jo käytetty. Asetuksia ei voi muuttaa normaalisti.',
    'Invoice draft not found.': 'Laskuluonnosta ei löytynyt.',
    'Approved invoice was not found.': 'Hyväksyttyä laskua ei löytynyt.',
  },
} as const;

export function getFinnishApiErrorMessage(message: string): string {
  return uiText.apiErrors[message as keyof typeof uiText.apiErrors] ?? message;
}
