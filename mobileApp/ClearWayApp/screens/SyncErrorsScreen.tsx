import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { DatabaseService } from '../services/database.service';
import { SyncService } from '../services/sync.service';
import { LocalMeasurement } from '../types';

type SyncErrorsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SyncErrors'>;

interface Props {
  navigation: SyncErrorsScreenNavigationProp;
}

export interface ErrorSessionGroup {
  session_id: string;
  count: number;
  error_message: string | null;
  first_error_at: string | null;
}

export interface UnsentSessionGroup {
  session_id: string;
  count: number;
  oldest_measurement_at: string | null;
}

export const SyncErrorsScreen: React.FC<Props> = ({ navigation }) => {
  const [unsentGroups, setUnsentGroups] = useState<UnsentSessionGroup[]>([]);
  const [errorGroups, setErrorGroups] = useState<ErrorSessionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncingSessionId, setSyncingSessionId] = useState<string | null>(null);
  const [retryingSessionId, setRetryingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<LocalMeasurement[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [unsent, errors] = await Promise.all([
        DatabaseService.getUnsentSessionGroups(),
        DatabaseService.getErrorSessionGroups(),
      ]);
      setUnsentGroups(unsent);
      setErrorGroups(errors);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadData();
  }, [loadData]);

  const handleOpenDetail = async (sessionId: string, isError: boolean) => {
    setSelectedSessionId(sessionId);
    setIsLoadingDetail(true);
    
    try {
      let data: LocalMeasurement[];
      
      if (isError) {
        // Load error records for this session
        const allErrors = await DatabaseService.getErrorRecords(10000);
        data = allErrors.filter(m => m.session_id === sessionId);
      } else {
        // Load unsent records for this session
        data = await DatabaseService.getUnsyncedMeasurementsBySession(sessionId, 10000);
      }
      
      setDetailData(data);
    } catch (error) {
      console.error('Failed to load detail data:', error);
      Alert.alert('Chyba', 'Nepodařilo se načíst detailní data.');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleCloseDetail = () => {
    setSelectedSessionId(null);
    setDetailData([]);
  };

  const handleSyncNow = async (sessionId: string) => {
    try {
      setSyncingSessionId(sessionId);
      
      // Trigger immediate sync
      await SyncService.forceSync();
      
      // Reload the list
      await loadData();
    } catch (error) {
      console.error('Failed to sync session:', error);
    } finally {
      setSyncingSessionId(null);
    }
  };

  const handleDeleteUnsent = (sessionId: string, count: number) => {
    const sessionIdShort = sessionId.substring(0, 8);
    
    Alert.alert(
      'Smazat čekající data',
      `Opravdu chcete smazat ${count} ${count === 1 ? 'měření' : count < 5 ? 'měření' : 'měření'} čekající na odeslání z jízdy ${sessionIdShort}...?\n\nTato akce je nevratná.`,
      [
        {
          text: 'Zrušit',
          style: 'cancel',
        },
        {
          text: 'Smazat',
          style: 'destructive',
          onPress: () => confirmDeleteUnsent(sessionId),
        },
      ]
    );
  };

  const confirmDeleteUnsent = async (sessionId: string) => {
    try {
      setDeletingSessionId(sessionId);
      
      // Delete unsent records for this session
      const count = await DatabaseService.deleteUnsentRecordsBySession(sessionId);
      
      if (count > 0) {
        console.log(`🗑️ Deleted ${count} unsent records for session ${sessionId}`);
        
        // Reload the list
        await loadData();
      }
    } catch (error) {
      console.error('Failed to delete unsent session:', error);
      Alert.alert('Chyba', 'Nepodařilo se smazat data. Zkuste to znovu.');
    } finally {
      setDeletingSessionId(null);
    }
  };

  const handleRetry = async (sessionId: string) => {
    try {
      setRetryingSessionId(sessionId);
      
      // Reset error records for this session back to unsynced state
      const count = await DatabaseService.retryErrorRecordsBySession(sessionId);
      
      if (count > 0) {
        console.log(`✓ Reset ${count} error records for session ${sessionId}`);
        
        // Trigger immediate sync for this session
        await SyncService.forceSync();
        
        // Reload the list
        await loadData();
      }
    } catch (error) {
      console.error('Failed to retry session:', error);
    } finally {
      setRetryingSessionId(null);
    }
  };

  const handleDelete = (sessionId: string, count: number) => {
    const sessionIdShort = sessionId.substring(0, 8);
    
    Alert.alert(
      'Smazat chybová data',
      `Opravdu chcete smazat ${count} ${count === 1 ? 'záznam' : count < 5 ? 'záznamy' : 'záznamů'} z jízdy ${sessionIdShort}...?\n\nTato akce je nevratná.`,
      [
        {
          text: 'Zrušit',
          style: 'cancel',
        },
        {
          text: 'Smazat',
          style: 'destructive',
          onPress: () => confirmDelete(sessionId),
        },
      ]
    );
  };

  const confirmDelete = async (sessionId: string) => {
    try {
      setDeletingSessionId(sessionId);
      
      // Delete error records for this session
      const count = await DatabaseService.deleteErrorRecordsBySession(sessionId);
      
      if (count > 0) {
        console.log(`🗑️ Deleted ${count} error records for session ${sessionId}`);
        
        // Reload the list
        await loadData();
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      Alert.alert('Chyba', 'Nepodařilo se smazat data. Zkuste to znovu.');
    } finally {
      setDeletingSessionId(null);
    }
  };

  const renderUnsentCard = ({ item }: { item: UnsentSessionGroup }) => {
    const isSyncing = syncingSessionId === item.session_id;
    const isDeleting = deletingSessionId === item.session_id;
    const isProcessing = isSyncing || isDeleting;
    const sessionIdShort = item.session_id.substring(0, 8);
    const measurementDate = item.oldest_measurement_at 
      ? new Date(item.oldest_measurement_at).toLocaleString('cs-CZ')
      : 'Neznámé datum';

    return (
      <TouchableOpacity 
        style={styles.unsentCard}
        onPress={() => handleOpenDetail(item.session_id, false)}
        activeOpacity={0.7}
      >
        <View style={styles.errorHeader}>
          <View>
            <Text style={styles.sessionId}>Jízda {sessionIdShort}...</Text>
            <Text style={styles.unsentDate}>{measurementDate}</Text>
          </View>
          <View style={styles.unsentCountBadge}>
            <Text style={styles.unsentCountText}>{item.count}</Text>
          </View>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.syncButton, isProcessing && styles.buttonDisabled]}
            onPress={(e) => {
              e.stopPropagation();
              handleSyncNow(item.session_id);
            }}
            disabled={isProcessing}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.syncButtonText}>Odeslat nyní</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deleteButton, isProcessing && styles.buttonDisabled]}
            onPress={(e) => {
              e.stopPropagation();
              handleDeleteUnsent(item.session_id, item.count);
            }}
            disabled={isProcessing}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#dc2626" />
            ) : (
              <Text style={styles.deleteButtonText}>Smazat</Text>
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderErrorCard = ({ item }: { item: ErrorSessionGroup }) => {
    const isRetrying = retryingSessionId === item.session_id;
    const isDeleting = deletingSessionId === item.session_id;
    const isProcessing = isRetrying || isDeleting;
    const sessionIdShort = item.session_id.substring(0, 8);
    const errorDate = item.first_error_at 
      ? new Date(item.first_error_at).toLocaleString('cs-CZ')
      : 'Neznámé datum';

    return (
      <TouchableOpacity 
        style={styles.errorCard}
        onPress={() => handleOpenDetail(item.session_id, true)}
        activeOpacity={0.7}
      >
        <View style={styles.errorHeader}>
          <View>
            <Text style={styles.sessionId}>Jízda {sessionIdShort}...</Text>
            <Text style={styles.errorDate}>{errorDate}</Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{item.count}</Text>
          </View>
        </View>
        
        {item.error_message && (
          <View style={styles.errorMessageBox}>
            <Text style={styles.errorMessageLabel}>Chyba:</Text>
            <Text style={styles.errorMessage} numberOfLines={2}>
              {item.error_message}
            </Text>
          </View>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.retryButton, isProcessing && styles.buttonDisabled]}
            onPress={(e) => {
              e.stopPropagation();
              handleRetry(item.session_id);
            }}
            disabled={isProcessing}
          >
            {isRetrying ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.retryButtonText}>Zkusit znovu</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deleteButton, isProcessing && styles.buttonDisabled]}
            onPress={(e) => {
              e.stopPropagation();
              handleDelete(item.session_id, item.count);
            }}
            disabled={isProcessing}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#dc2626" />
            ) : (
              <Text style={styles.deleteButtonText}>Smazat</Text>
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.checkmarkCircle}>
        <Text style={styles.checkmark}>✓</Text>
      </View>
      <Text style={styles.emptyTitle}>Vše v pořádku</Text>
      <Text style={styles.emptySubtitle}>
        Všechna data jsou úspěšně odeslána na server
      </Text>
    </View>
  );

  const renderDetailModal = () => {
    if (!selectedSessionId) return null;

    const sessionIdShort = selectedSessionId.substring(0, 8);
    const isError = detailData.length > 0 && detailData[0].synced === -1;

    return (
      <Modal
        visible={selectedSessionId !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseDetail}
      >
        <Pressable style={styles.modalOverlay} onPress={handleCloseDetail}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isError ? '❌ Detail chyby' : '⏳ Detail čekajících dat'}
              </Text>
              <TouchableOpacity onPress={handleCloseDetail} style={styles.modalCloseButton}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalSessionInfo}>
              <Text style={styles.modalSessionLabel}>ID jízdy:</Text>
              <Text style={styles.modalSessionValue}>{selectedSessionId}</Text>
              <Text style={styles.modalSessionShort}>({sessionIdShort}...)</Text>
            </View>

            {isLoadingDetail ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color="#18181b" />
                <Text style={styles.modalLoadingText}>Načítání detailů...</Text>
              </View>
            ) : (
              <ScrollView style={styles.modalScrollView}>
                <View style={styles.modalStats}>
                  <View style={styles.modalStatItem}>
                    <Text style={styles.modalStatLabel}>Celkem záznamů</Text>
                    <Text style={styles.modalStatValue}>{detailData.length}</Text>
                  </View>
                  {detailData.length > 0 && (
                    <>
                      <View style={styles.modalStatItem}>
                        <Text style={styles.modalStatLabel}>První měření</Text>
                        <Text style={styles.modalStatValue}>
                          {new Date(detailData[0].measured_at).toLocaleString('cs-CZ')}
                        </Text>
                      </View>
                      <View style={styles.modalStatItem}>
                        <Text style={styles.modalStatLabel}>Poslední měření</Text>
                        <Text style={styles.modalStatValue}>
                          {new Date(detailData[detailData.length - 1].measured_at).toLocaleString('cs-CZ')}
                        </Text>
                      </View>
                    </>
                  )}
                </View>

                {isError && detailData.length > 0 && detailData[0].error_message && (
                  <View style={styles.modalErrorBox}>
                    <Text style={styles.modalErrorLabel}>Chybová zpráva:</Text>
                    <Text style={styles.modalErrorText}>{detailData[0].error_message}</Text>
                    {detailData[0].error_at && (
                      <Text style={styles.modalErrorDate}>
                        Čas chyby: {new Date(detailData[0].error_at).toLocaleString('cs-CZ')}
                      </Text>
                    )}
                  </View>
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Zpět</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Neodeslaná data</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#18181b" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Zpět</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Neodeslaná data</Text>
      </View>

      {unsentGroups.length === 0 && errorGroups.length === 0 ? (
        <View style={styles.content}>
          {renderEmptyState()}
        </View>
      ) : (
        <ScrollView 
          style={styles.content}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
        >
          {/* Čekající na odeslání (synced = 0) */}
          {unsentGroups.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>⏳ Čekající na odeslání</Text>
                <Text style={styles.sectionSubtitle}>
                  Měření čekají na automatické odeslání nebo selhal server
                </Text>
              </View>
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Nalezeno {unsentGroups.length} {unsentGroups.length === 1 ? 'jízda' : unsentGroups.length < 5 ? 'jízdy' : 'jízd'} s čekajícími měřeními
                </Text>
              </View>
              {unsentGroups.map((item) => (
                <View key={item.session_id}>
                  {renderUnsentCard({ item })}
                </View>
              ))}
            </View>
          )}

          {/* Chybná data (synced = -1) */}
          {errorGroups.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>❌ Chybná data</Text>
                <Text style={styles.sectionSubtitle}>
                  Data se špatnými hodnotami (nebudou automaticky odeslána)
                </Text>
              </View>
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Nalezeno {errorGroups.length} {errorGroups.length === 1 ? 'problémová jízda' : errorGroups.length < 5 ? 'problémové jízdy' : 'problémových jízd'} s chybami
                </Text>
              </View>
              {errorGroups.map((item) => (
                <View key={item.session_id}>
                  {renderErrorCard({ item })}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {renderDetailModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  header: {
    backgroundColor: '#fff',
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
  },
  backButton: {
    marginBottom: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#3b82f6',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#18181b',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#18181b',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#71717a',
    lineHeight: 20,
  },
  infoBox: {
    backgroundColor: '#fef3c7',
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
    padding: 16,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 16,
    borderRadius: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#92400e',
  },
  unsentCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  unsentDate: {
    fontSize: 12,
    color: '#71717a',
  },
  unsentCountBadge: {
    backgroundColor: '#dbeafe',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  unsentCountText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e40af',
  },
  syncButton: {
    flex: 1,
    backgroundColor: '#10b981',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  syncButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  listContent: {
    padding: 20,
  },
  errorCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  errorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  sessionId: {
    fontSize: 16,
    fontWeight: '600',
    color: '#18181b',
    marginBottom: 4,
  },
  errorDate: {
    fontSize: 12,
    color: '#71717a',
  },
  countBadge: {
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  countText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#dc2626',
  },
  errorMessageBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorMessageLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#991b1b',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 14,
    color: '#dc2626',
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  retryButton: {
    flex: 1,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#dc2626',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  checkmarkCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#dcfce7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  checkmark: {
    fontSize: 48,
    color: '#16a34a',
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#18181b',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 24,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '90%',
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#18181b',
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f4f4f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 20,
    color: '#71717a',
    fontWeight: 'bold',
  },
  modalSessionInfo: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
  },
  modalSessionLabel: {
    fontSize: 12,
    color: '#71717a',
    marginBottom: 4,
  },
  modalSessionValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#18181b',
    fontFamily: 'monospace',
  },
  modalSessionShort: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 2,
  },
  modalLoading: {
    padding: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalLoadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#71717a',
  },
  modalScrollView: {
    maxHeight: '100%',
  },
  modalStats: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
  },
  modalStatItem: {
    marginBottom: 12,
  },
  modalStatLabel: {
    fontSize: 12,
    color: '#71717a',
    marginBottom: 4,
  },
  modalStatValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#18181b',
  },
  modalErrorBox: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
    padding: 16,
    margin: 16,
    marginTop: 0,
    borderRadius: 8,
  },
  modalErrorLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#991b1b',
    marginBottom: 8,
  },
  modalErrorText: {
    fontSize: 14,
    color: '#dc2626',
    lineHeight: 20,
    marginBottom: 8,
  },
  modalErrorDate: {
    fontSize: 12,
    color: '#991b1b',
    fontStyle: 'italic',
  },
});
