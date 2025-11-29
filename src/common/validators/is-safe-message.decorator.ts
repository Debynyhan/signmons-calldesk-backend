import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

const MAX_MESSAGE_LENGTH = 500;
const CONTROL_CHAR_PATTERN = "[\\u0000-\\u001F\\u007F]";
const CONTROL_CHAR_REGEX = new RegExp(CONTROL_CHAR_PATTERN);

@ValidatorConstraint({ name: "safeMessage", async: false })
export class SafeMessageConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string") {
      return false;
    }

    const trimmed = value.trim();
    if (!trimmed.length || trimmed.length > MAX_MESSAGE_LENGTH) {
      return false;
    }

    return !CONTROL_CHAR_REGEX.test(trimmed);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be between 1 and ${MAX_MESSAGE_LENGTH} characters and cannot include control characters.`;
  }
}

export function IsSafeMessage(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: SafeMessageConstraint,
    });
  };
}
