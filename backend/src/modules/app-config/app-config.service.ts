import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AppConfiguration } from './entities/app-configuration.entity';

export interface AppFeaturesSettings {
  voiceCallsEnabled: boolean;
  videoCallsEnabled: boolean;
  screenSharingEnabled: boolean;
  screenSharingDirectEnabled: boolean;
  screenSharingGroupsEnabled: boolean;
  screenMaxResolution: string;
  screenMaxFps: number;
  screenMaxConcurrentSessions: number;
  screenBandwidthLimitKbps: number | null;
  turnConfigured: boolean;
  updatedAt: string;
}

export interface AppFeaturesUpdate {
  voiceCallsEnabled?: boolean;
  videoCallsEnabled?: boolean;
  screenSharingEnabled?: boolean;
  screenSharingDirectEnabled?: boolean;
  screenSharingGroupsEnabled?: boolean;
  screenMaxResolution?: string;
  screenMaxFps?: number;
  screenMaxConcurrentSessions?: number;
  screenBandwidthLimitKbps?: number | null;
}

/**
 * Hot-reloadable application feature flags. Cached in memory; invalidated on update.
 */
@Injectable()
export class AppConfigService implements OnModuleInit {
  private readonly logger = new Logger(AppConfigService.name);
  private cache: AppConfiguration | null = null;
  private cacheLoadedAt = 0;
  private readonly cacheTtlMs = 5_000;

  constructor(
    @InjectRepository(AppConfiguration)
    private readonly configRepo: Repository<AppConfiguration>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.getConfig();
  }

  async getConfig(forceRefresh = false): Promise<AppConfiguration> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cache &&
      now - this.cacheLoadedAt < this.cacheTtlMs
    ) {
      return this.cache;
    }

    let config = await this.configRepo
      .find({
        order: { createdAt: 'ASC' },
        take: 1,
      })
      .then((rows) => rows[0] ?? null);

    if (!config) {
      config = await this.configRepo.save(this.configRepo.create({}));
      this.logger.log('Created default app configuration');
    }

    this.cache = config;
    this.cacheLoadedAt = now;
    return config;
  }

  invalidateCache() {
    this.cache = null;
    this.cacheLoadedAt = 0;
  }

  async getFeatures(): Promise<AppFeaturesSettings> {
    const config = await this.getConfig();
    return this.toPublic(config);
  }

  async updateFeatures(input: AppFeaturesUpdate): Promise<AppFeaturesSettings> {
    const config = await this.getConfig(true);

    if (input.voiceCallsEnabled !== undefined) {
      config.voiceCallsEnabled = input.voiceCallsEnabled;
    }
    if (input.videoCallsEnabled !== undefined) {
      config.videoCallsEnabled = input.videoCallsEnabled;
    }
    if (input.screenSharingEnabled !== undefined) {
      config.screenSharingEnabled = input.screenSharingEnabled;
    }
    if (input.screenSharingDirectEnabled !== undefined) {
      config.screenSharingDirectEnabled = input.screenSharingDirectEnabled;
    }
    if (input.screenSharingGroupsEnabled !== undefined) {
      config.screenSharingGroupsEnabled = input.screenSharingGroupsEnabled;
    }
    if (input.screenMaxResolution !== undefined) {
      config.screenMaxResolution = input.screenMaxResolution;
    }
    if (input.screenMaxFps !== undefined) {
      config.screenMaxFps = input.screenMaxFps;
    }
    if (input.screenMaxConcurrentSessions !== undefined) {
      config.screenMaxConcurrentSessions = input.screenMaxConcurrentSessions;
    }
    if (input.screenBandwidthLimitKbps !== undefined) {
      config.screenBandwidthLimitKbps = input.screenBandwidthLimitKbps;
    }

    const saved = await this.configRepo.save(config);
    this.invalidateCache();
    this.cache = saved;
    this.cacheLoadedAt = Date.now();
    return this.toPublic(saved);
  }

  private isTurnConfigured(): boolean {
    return Boolean(
      this.config.get<string>('TURN_URL') &&
        this.config.get<string>('TURN_USERNAME') &&
        this.config.get<string>('TURN_PASSWORD'),
    );
  }

  toPublic(config: AppConfiguration): AppFeaturesSettings {
    return {
      voiceCallsEnabled: config.voiceCallsEnabled,
      videoCallsEnabled: config.videoCallsEnabled,
      screenSharingEnabled: config.screenSharingEnabled,
      screenSharingDirectEnabled: config.screenSharingDirectEnabled,
      screenSharingGroupsEnabled: config.screenSharingGroupsEnabled,
      screenMaxResolution: config.screenMaxResolution,
      screenMaxFps: config.screenMaxFps,
      screenMaxConcurrentSessions: config.screenMaxConcurrentSessions,
      screenBandwidthLimitKbps: config.screenBandwidthLimitKbps ?? null,
      turnConfigured: this.isTurnConfigured(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }
}
