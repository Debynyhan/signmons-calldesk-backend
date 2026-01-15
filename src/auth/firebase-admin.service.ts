import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import admin from "firebase-admin";
import appConfig from "../config/app.config";

@Injectable()
export class FirebaseAdminService {
  private readonly app: admin.app.App;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {
    if (admin.apps.length > 0) {
      this.app = admin.apps[0];
      return;
    }

    const options: admin.AppOptions = {};
    const projectId =
      this.config.firebaseProjectId ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      undefined;
    if (projectId) {
      options.projectId = projectId;
    }

    options.credential = admin.credential.applicationDefault();
    this.app = admin.initializeApp(options);
  }

  getAuth(): admin.auth.Auth {
    return admin.auth(this.app);
  }
}
