import { type } from "arktype";
import { TRValidationError } from "./errors.ts";
import { validateResponse, type ResponseValidation } from "./validation.ts";

const NameSchema = type({ first: "string", last: "string" });
const BaseAccountSchema = type({ iban: "string", bic: "string | null" });
const EnhancedAccountSchema = BaseAccountSchema.merge({
  bankName: "string",
  logoUrl: "string | null",
});
const ExperienceItemSchema = type({
  tradeCount: "number",
  level: "string",
  showsRiskWarning: "boolean",
});
const ExperienceItemWithoutTradeCountSchema = type({
  level: "string",
  showsRiskWarning: "boolean",
});
const TaxExemptionOrderSchema = type({
  minimum: "number",
  maximum: "number",
  current: "number",
  applied: "number",
  syncStatus: "string",
  validFrom: "string",
  "validUntil?": "string | null",
});

export const AccountInfoSchema = type({
  phoneNumber: "string",
  jurisdiction: "string",
  name: NameSchema,
  email: { address: "string", verified: "boolean" },
  duplicateTradingEmail: "string | null",
  postalAddress: {
    street: "string",
    houseNo: "string",
    "addressAddendum?": "string | null",
    zip: "string",
    city: "string",
    country: "string",
  },
  birthdate: "string",
  birthplace: { birthplace: "string", birthcountry: "string" },
  mainNationality: "string",
  additionalNationalities: "string[]",
  mainTaxResidency: { tin: "string", countryCode: "string" },
  usTaxResidency: "boolean",
  additionalTaxResidencies: "string[]",
  taxInformationSyncTimestamp: "number",
  taxExemptionOrder: TaxExemptionOrderSchema,
  registrationAccount: "boolean",
  cashAccount: EnhancedAccountSchema,
  referenceAccount: BaseAccountSchema,
  referenceAccountV2: EnhancedAccountSchema,
  referenceAccountList: EnhancedAccountSchema.array(),
  securitiesAccountNumber: "string",
  experience: {
    stock: ExperienceItemSchema,
    fund: ExperienceItemSchema,
    derivative: ExperienceItemSchema,
    crypto: ExperienceItemSchema,
    bond: ExperienceItemWithoutTradeCountSchema,
  },
  referralDetails: "unknown | null",
  supportDocuments: {
    accountClosing: "string",
    imprint: "string",
    addressConfirmation: "string",
  },
  tinFormat: { placeholder: "string", keyboardLayout: "string" },
  personId: "string",
}).onDeepUndeclaredKey("reject");
export type AccountInfo = typeof AccountInfoSchema.infer;

export const PersonalDetailsSchema = type({
  phoneNumber: "string",
  verifiedEmail: "string",
  unverifiedEmail: "string | null",
  address: {
    street: "string",
    streetNo: "string",
    postalCode: "string",
    city: "string",
    countryCode: "string",
  },
  firstName: "string",
  lastName: "string",
  maritalStatus: "string",
  birthdate: "string",
  birthplace: "string",
  birthplaceCountryCode: "string",
  citizenships: "string[]",
  taxResidencies: type({
    country: "string",
    taxId: "string",
    taxIdFormat: { placeholder: "string", keyboardLayout: "string" },
    primary: "boolean",
  }).array(),
}).onDeepUndeclaredKey("reject");
export type PersonalDetails = typeof PersonalDetailsSchema.infer;

const AdditionalDataSchema = type({ empty: "boolean", mapType: "string" }).or("null");
const FeeSchema = type({
  flat: "string",
  percentage: "string",
  additionalData: AdditionalDataSchema,
});
const LimitsSchema = type({
  min: "number",
  max: "number",
  complianceLimit: "number",
  yearlyLimit: "number",
  quarterlyLimit: "number",
  unverifiedCustomerLimit: "number | null",
});
const BrandSchema = type({
  name: "string",
  fee: FeeSchema,
  iconUrl: "string | null",
  code: "string",
  logoResourceIdentifier: "string | null",
});
const BrandDetailsSchema = BrandSchema.merge({
  iconUrlLight: "string | null",
  iconUrlDark: "string | null",
}).or("null");
const BasePaymentMethodSchema = type({
  id: "string",
  code: "string",
  name: "string",
  brands: BrandSchema.array(),
  savingAllowed: "boolean",
  limits: LimitsSchema,
  fee: FeeSchema,
  iconUrl: "string | null",
  tosUrl: "string | null",
  customerAgreementUrl: "string | null",
  status: "string",
  agbUrl: "string | null",
});
const StoredSavingsPlanPaymentMethodSchema = type({
  id: "string",
  name: "string",
  customerId: "string",
  paymentMethodCode: "string",
  lastDigit: "string",
  validUntil: "string | null",
  holderName: "string | null",
  brand: "string | null",
  brandDetails: BrandDetailsSchema,
  iban: "string",
  bic: "string | null",
  status: "string",
  limits: LimitsSchema,
  fee: FeeSchema,
  createdAt: "string",
  lastUsedAt: "string | null",
  issuerName: "string",
  logoResourceIdentifier: "string | null",
  cardIssuerBin: "string | null",
  cardIssuingCountry: "string | null",
  registeredByService: "string | null",
});

export const PaymentMethodsSchema = type({
  availablePaymentMethods: BasePaymentMethodSchema.array(),
  availableSavingsPlanPaymentMethods: BasePaymentMethodSchema.array(),
  storedPaymentMethods: "unknown[]",
  storedSavingsPlanPaymentMethods: StoredSavingsPlanPaymentMethodSchema.array(),
  customerData: {
    id: "string",
    firstName: "string",
    lastName: "string",
    virtualIban: "string",
    bankName: "string",
    bic: "string",
    referenceAccountList: type({ iban: "string", bankName: "string" }).array(),
    referenceAccount: "string",
  },
}).onDeepUndeclaredKey("reject");
export type PaymentMethods = typeof PaymentMethodsSchema.infer;

export const TaxResidencySchema = type({
  name: "string",
  countryCode: type("string").exactlyLength(2),
  fatcaRelevance: "boolean",
  eu: "boolean",
  features: "string[]",
})
  .array()
  .onDeepUndeclaredKey("reject");
export type TaxResidency = typeof TaxResidencySchema.infer;

export const TaxInformationSchema = type({
  syncTimestamp: "string",
  fsaApplied: "number",
  fsaUsed: "number",
  fsaRemaining: "number",
  lossSetOffStocks: "number",
  lossSetOffOthers: "number",
  lossSetOffWithholdingTax: "number",
}).onDeepUndeclaredKey("reject");
export type TaxInformation = typeof TaxInformationSchema.infer;

export const TaxExemptionOrdersSchema = TaxExemptionOrderSchema.onDeepUndeclaredKey("reject");
export type TaxExemptionOrders = typeof TaxExemptionOrdersSchema.infer;

export const AllDocumentsSchema = type({
  documents: type({
    id: "string",
    title: "string",
    url: "string",
    description: "string",
    contentType: "string",
    version: "number",
  }).array(),
}).onDeepUndeclaredKey("reject");
export type AllDocuments = typeof AllDocumentsSchema.infer;

/** The single source of truth for authenticated Trade Republic HTTP resources. */
export const resourceRegistry = {
  accountInfo: { path: "/api/v2/auth/account", response: AccountInfoSchema },
  personalDetails: {
    path: "/api/v1/customer/personal-details",
    response: PersonalDetailsSchema,
  },
  paymentMethods: { path: "/api/v2/payment/methods", response: PaymentMethodsSchema },
  taxResidency: { path: "/api/v1/country/taxresidency", response: TaxResidencySchema },
  taxInformation: { path: "/api/v1/taxes/information", response: TaxInformationSchema },
  taxExemptionOrders: {
    path: "/api/v1/taxes/exemptionorders",
    response: TaxExemptionOrdersSchema,
  },
  allDocuments: { path: "/api/v1/documents/all", response: AllDocumentsSchema },
} as const;

export type ResourceName = keyof typeof resourceRegistry;
export type ResourceResponse<Name extends ResourceName> =
  (typeof resourceRegistry)[Name]["response"]["infer"];

export const resourceNames = Object.keys(resourceRegistry).filter(isResourceName);

function isResourceName(name: string): name is ResourceName {
  return Object.hasOwn(resourceRegistry, name);
}

export async function decodeResourceResponse<Name extends ResourceName>(
  name: Name,
  response: Response,
  validation: ResponseValidation,
): Promise<ResourceResponse<Name>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch (cause) {
    throw new TRValidationError(`Invalid JSON for Resource "${name}"`, { cause });
  }
  return validateResponse<ResourceResponse<Name>>(
    resourceRegistry[name].response,
    value,
    `Resource "${name}"`,
    validation,
  );
}
