import { z } from "zod";

export const LoginResponseDataSchema = z.object({
  processId: z.string(),
  countdownInSeconds: z.number(),
  ["2fa"]: z.string(),
});

export type LoginResponseData = z.infer<typeof LoginResponseDataSchema>;

export const LoginResponseSchema = z.object({
  data: LoginResponseDataSchema,
  cookies: z.array(z.string()),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

const NameSchema = z.object({
  first: z.string(),
  last: z.string(),
});

const BaseAccountSchema = z.object({
  iban: z.string(),
  bic: z.string().nullable(),
});

const EnhancedAccountSchema = BaseAccountSchema.extend({
  bankName: z.string(),
  logoUrl: z.string(),
});

const CashAccountSchema = BaseAccountSchema.extend({
  bankName: z.string(),
  logoUrl: z.string().nullable(),
});

const ExperienceItemSchema = z.object({
  tradeCount: z.number(),
  level: z.string(),
  showsRiskWarning: z.boolean(),
});

const ExperienceItemWithoutTradeCountSchema = z.object({
  level: z.string(),
  showsRiskWarning: z.boolean(),
});

const TaxExemptionOrderSchema = z.object({
  minimum: z.number(),
  maximum: z.number(),
  current: z.number(),
  applied: z.number(),
  syncStatus: z.string(),
  validFrom: z.string(),
  validUntil: z.string().nullable(),
});

const SupportDocumentsSchema = z.object({
  accountClosing: z.string(),
  imprint: z.string(),
  addressConfirmation: z.string(),
});

const TinFormatSchema = z.object({
  placeholder: z.string(),
  keyboardLayout: z.string(),
});

export const AccountInfoSchema = z.object({
  phoneNumber: z.string(),
  jurisdiction: z.string(),
  name: NameSchema,
  email: z.object({
    address: z.string(),
    verified: z.boolean(),
  }),
  duplicateTradingEmail: z.string().nullable(),
  postalAddress: z.object({
    street: z.string(),
    houseNo: z.string(),
    zip: z.string(),
    city: z.string(),
    country: z.string(),
  }),
  birthdate: z.string(),
  birthplace: z.object({
    birthplace: z.string(),
    birthcountry: z.string(),
  }),
  mainNationality: z.string(),
  additionalNationalities: z.array(z.string()),
  mainTaxResidency: z.object({
    tin: z.string(),
    countryCode: z.string(),
  }),
  usTaxResidency: z.boolean(),
  additionalTaxResidencies: z.array(z.string()),
  taxInformationSyncTimestamp: z.number(),
  taxExemptionOrder: TaxExemptionOrderSchema,
  registrationAccount: z.boolean(),
  cashAccount: CashAccountSchema,
  referenceAccount: BaseAccountSchema,
  referenceAccountV2: EnhancedAccountSchema,
  referenceAccountList: z.array(EnhancedAccountSchema),
  securitiesAccountNumber: z.string(),
  experience: z.object({
    stock: ExperienceItemSchema,
    fund: ExperienceItemSchema,
    derivative: ExperienceItemSchema,
    crypto: ExperienceItemSchema,
    bond: ExperienceItemWithoutTradeCountSchema,
  }),
  referralDetails: z.unknown().nullable(),
  supportDocuments: SupportDocumentsSchema,
  tinFormat: TinFormatSchema,
  personId: z.string(),
});

export type AccountInfo = z.infer<typeof AccountInfoSchema>;

export const TrendingStocksSchema = z.object({
  items: z.array(
    z.object({
      isin: z.string(),
      shortName: z.string(),
      instrumentType: z.string(),
    }),
  ),
  correlationId: z.string(),
});

export type TrendingStocks = z.infer<typeof TrendingStocksSchema>;

export const TaxExemptionOrdersSchema = TaxExemptionOrderSchema;

export type TaxExemptionOrders = z.infer<typeof TaxExemptionOrdersSchema>;

export const PersonalDetailsSchema = z.object({
  phoneNumber: z.string(),
  verifiedEmail: z.string(),
  unverifiedEmail: z.string().nullable(),
  address: z.object({
    street: z.string(),
    streetNo: z.string(),
    postalCode: z.string(),
    city: z.string(),
    countryCode: z.string(),
  }),
  firstName: z.string(),
  lastName: z.string(),
  maritalStatus: z.string(),
  birthdate: z.string(),
  birthplace: z.string(),
  birthplaceCountryCode: z.string(),
  citizenships: z.array(z.string()),
  taxResidencies: z.array(
    z.object({
      country: z.string(),
      taxId: z.string(),
      taxIdFormat: z.object({
        placeholder: z.string(),
        keyboardLayout: z.string(),
      }),
      primary: z.boolean(),
    }),
  ),
});

export type PersonalDetails = z.infer<typeof PersonalDetailsSchema>;

const AdditionalDataSchema = z
  .object({
    empty: z.boolean(),
    mapType: z.string(),
  })
  .nullable();

const FeeSchema = z.object({
  flat: z.string(),
  percentage: z.string(),
  additionalData: AdditionalDataSchema,
});

const LimitsSchema = z.object({
  min: z.number(),
  max: z.number(),
  complianceLimit: z.number(),
  yearlyLimit: z.number(),
  quarterlyLimit: z.number(),
  unverifiedCustomerLimit: z.number().nullable(),
});

const BrandSchema = z.object({
  name: z.string(),
  fee: FeeSchema,
  iconUrl: z.string().nullable(),
  code: z.string(),
  logoResourceIdentifier: z.string().nullable(),
});

const BrandDetailsSchema = z
  .object({
    name: z.string(),
    fee: FeeSchema,
    iconUrl: z.string().nullable(),
    iconUrlLight: z.string().nullable(),
    iconUrlDark: z.string().nullable(),
    code: z.string(),
    logoResourceIdentifier: z.string().nullable(),
  })
  .nullable();

const BasePaymentMethodSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  brands: z.array(BrandSchema),
  savingAllowed: z.boolean(),
  limits: LimitsSchema,
  fee: FeeSchema,
  iconUrl: z.string().nullable(),
  tosUrl: z.string().nullable(),
  customerAgreementUrl: z.string().nullable(),
  status: z.string(),
  agbUrl: z.string().nullable(),
});

const StoredSavingsPlanPaymentMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  customerId: z.string(),
  paymentMethodCode: z.string(),
  lastDigit: z.string(),
  validUntil: z.string().nullable(),
  holderName: z.string().nullable(),
  brand: z.string().nullable(),
  brandDetails: BrandDetailsSchema,
  iban: z.string(),
  bic: z.string().nullable(),
  status: z.string(),
  limits: LimitsSchema,
  fee: z.object({
    flat: z.string(),
    percentage: z.string(),
    additionalData: AdditionalDataSchema,
  }),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  issuerName: z.string(),
  logoResourceIdentifier: z.string().nullable(),
  cardIssuerBin: z.string().nullable(),
  cardIssuingCountry: z.string().nullable(),
  registeredByService: z.string().nullable(),
});

export const PaymentMethodsSchema = z.object({
  availablePaymentMethods: z.array(BasePaymentMethodSchema),
  availableSavingsPlanPaymentMethods: z.array(BasePaymentMethodSchema),
  storedPaymentMethods: z.array(z.any()),
  storedSavingsPlanPaymentMethods: z.array(StoredSavingsPlanPaymentMethodSchema),
  customerData: z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    virtualIban: z.string(),
    bankName: z.string(),
    bic: z.string(),
    referenceAccountList: z.array(
      z.object({
        iban: z.string(),
        bankName: z.string(),
      }),
    ),
    referenceAccount: z.string(),
  }),
});

export type PaymentMethods = z.infer<typeof PaymentMethodsSchema>;

export const TaxResidencySchema = z.array(
  z.object({
    name: z.string(),
    countryCode: z.string().length(2),
    fatcaRelevance: z.boolean(),
    eu: z.boolean(),
    features: z.array(z.string()),
  }),
);

export type TaxResidency = z.infer<typeof TaxResidencySchema>;

export const TaxInformationSchema = z.object({
  syncTimestamp: z.string(),
  fsaApplied: z.number(),
  fsaUsed: z.number(),
  fsaRemaining: z.number(),
  lossSetOffStocks: z.number(),
  lossSetOffOthers: z.number(),
  lossSetOffWithholdingTax: z.number(),
});

export type TaxInformation = z.infer<typeof TaxInformationSchema>;

export const AllDocumentsSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      description: z.string(),
      contentType: z.string(),
    }),
  ),
});

export type AllDocuments = z.infer<typeof AllDocumentsSchema>;
